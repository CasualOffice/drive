//! Agentic research loop — the "not generic MCP" path.
//!
//! Where [`crate::answer`] / [`crate::remote`] do *single-shot* RAG (retrieve
//! once, answer once), this drives a **ReAct loop**: the model decides when to
//! search, issues its own queries, reads the passages, searches again if it
//! needs more, and only then commits a cited answer. It works against any
//! [`ChatModel`] (Claude / OpenAI / a local server — same config as the rest of
//! the AI layer) and any [`Retriever`], so it is provider-agnostic and fully
//! testable offline with a scripted model + a canned retriever.
//!
//! ## Protocol
//! The model must reply with exactly one JSON object per turn:
//! - `{"action":"search","query":"…"}` — retrieve more passages.
//! - `{"action":"answer","text":"… [n] …","citations":[n,…]}` — final answer.
//!
//! Retrieved passages accumulate into a numbered pool across turns; the model
//! cites them by their pool number, which maps straight back to a source
//! document. The loop is bounded ([`AgentConfig::max_steps`]) so a wandering or
//! misbehaving model always terminates.

use std::collections::HashSet;
use std::fmt::Write as _;

use async_trait::async_trait;
use serde_json::Value;

use crate::answer::{AnswerContext, Citation};
use crate::embed::AiError;
use crate::remote::{ChatMessage, ChatModel};

/// Retrieves passages relevant to a query. The agent's only door to the corpus;
/// an implementation is expected to enforce workspace + permission scoping
/// before returning anything.
#[async_trait]
pub trait Retriever: Send + Sync {
    /// Return up to `k` passages relevant to `query`, best first.
    async fn retrieve(&self, query: &str, k: usize) -> Result<Vec<AnswerContext>, AiError>;
}

/// Tuning for the loop. Defaults are conservative — a few steps, a handful of
/// passages per search, a bounded pool — enough for real questions without
/// letting a model run away.
#[derive(Debug, Clone, Copy)]
pub struct AgentConfig {
    /// Max model turns before the loop gives up (each turn is one `chat` call).
    pub max_steps: usize,
    /// Passages requested per `search` action.
    pub per_search: usize,
    /// Cap on the accumulated passage pool (bounds prompt growth).
    pub max_pool: usize,
    /// Max characters of a passage shown to the model (bounds prompt growth).
    pub passage_chars: usize,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            max_steps: 6,
            per_search: 6,
            max_pool: 24,
            passage_chars: 600,
        }
    }
}

/// The result of a research run.
#[derive(Debug, Clone)]
pub struct AgentOutcome {
    /// Final answer text (empty if the loop never produced one).
    pub answer: String,
    /// Citations into `contexts`, in first-use order.
    pub citations: Vec<Citation>,
    /// The passage pool the agent accumulated; citation indices point into it.
    pub contexts: Vec<AnswerContext>,
    /// The queries the agent issued, in order — a transparent trace of its work.
    pub searches: Vec<String>,
}

const AGENT_SYSTEM_PROMPT: &str = "You are a research agent for a company's private \
document hub. You answer questions strictly from the user's documents — you have no \
outside knowledge and must not invent facts.\n\n\
Reply with EXACTLY ONE JSON object and nothing else (no prose, no markdown fences), \
in one of these two forms:\n\
- To search the documents: {\"action\":\"search\",\"query\":\"<search terms>\"}\n\
- To give your final answer: {\"action\":\"answer\",\"text\":\"<answer with inline [n] citations>\",\"citations\":[<passage numbers used>]}\n\n\
Rules:\n\
- You start with no passages; always search before answering.\n\
- Passages are numbered as you retrieve them. Cite them inline as [n] and list the numbers in \"citations\".\n\
- If, after searching, the documents do not contain the answer, reply with an answer whose text says you could not find it and whose citations are empty.\n\
- Refine your query and search again if the first results are insufficient.";

/// The agentic research loop, bound to a chat model and a retriever.
pub struct Agent<'a> {
    chat: &'a dyn ChatModel,
    retriever: &'a dyn Retriever,
    cfg: AgentConfig,
}

impl std::fmt::Debug for Agent<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // The trait objects aren't `Debug`; the config is the useful state.
        f.debug_struct("Agent").field("cfg", &self.cfg).finish()
    }
}

impl<'a> Agent<'a> {
    #[must_use]
    pub fn new(chat: &'a dyn ChatModel, retriever: &'a dyn Retriever) -> Self {
        Self {
            chat,
            retriever,
            cfg: AgentConfig::default(),
        }
    }

    #[must_use]
    pub fn with_config(mut self, cfg: AgentConfig) -> Self {
        self.cfg = cfg;
        self
    }

    /// Run the loop for `question`. Always terminates: it returns as soon as the
    /// model emits an `answer` action, or with an empty answer once
    /// [`AgentConfig::max_steps`] turns are spent.
    pub async fn run(&self, question: &str) -> Result<AgentOutcome, AiError> {
        let question = question.trim();
        let mut messages = vec![
            ChatMessage::system(AGENT_SYSTEM_PROMPT),
            ChatMessage::user(format!("Question: {question}")),
        ];
        let mut pool: Vec<AnswerContext> = Vec::new();
        let mut searches: Vec<String> = Vec::new();

        if question.is_empty() {
            return Ok(AgentOutcome {
                answer: String::new(),
                citations: Vec::new(),
                contexts: pool,
                searches,
            });
        }

        for _ in 0..self.cfg.max_steps {
            let reply = self.chat.chat(&messages).await?;
            messages.push(ChatMessage::assistant(reply.clone()));

            let Some(action) = parse_action(&reply) else {
                messages.push(ChatMessage::user(
                    "That was not a single JSON object. Reply with exactly one JSON object: \
                     {\"action\":\"search\",\"query\":\"...\"} or \
                     {\"action\":\"answer\",\"text\":\"...\",\"citations\":[...]}."
                        .to_string(),
                ));
                continue;
            };

            match action.get("action").and_then(Value::as_str) {
                Some("search") => {
                    let query = action
                        .get("query")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .trim()
                        .to_string();
                    if query.is_empty() {
                        messages.push(ChatMessage::user(
                            "The search query was empty. Provide a non-empty query or give your \
                             final answer."
                                .to_string(),
                        ));
                        continue;
                    }
                    searches.push(query.clone());

                    let observation = if pool.len() >= self.cfg.max_pool {
                        "You have gathered enough passages. Give your final answer now.".to_string()
                    } else {
                        let hits = self.retriever.retrieve(&query, self.cfg.per_search).await?;
                        self.absorb(&mut pool, hits)
                    };
                    messages.push(ChatMessage::user(observation));
                }
                Some("answer") => {
                    let text = action
                        .get("text")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    let citations = collect_citations(&action, &text, &pool);
                    return Ok(AgentOutcome {
                        answer: text,
                        citations,
                        contexts: pool,
                        searches,
                    });
                }
                _ => {
                    messages.push(ChatMessage::user(
                        "Unknown action. Use \"search\" or \"answer\".".to_string(),
                    ));
                }
            }
        }

        // Steps exhausted without a final answer — return the trace, empty answer.
        Ok(AgentOutcome {
            answer: String::new(),
            citations: Vec::new(),
            contexts: pool,
            searches,
        })
    }

    /// Merge freshly retrieved passages into the pool (deduped by source + text,
    /// capped) and render the observation message describing the new, numbered
    /// passages.
    fn absorb(&self, pool: &mut Vec<AnswerContext>, hits: Vec<AnswerContext>) -> String {
        let before = pool.len();
        for c in hits {
            if pool.len() >= self.cfg.max_pool {
                break;
            }
            if pool
                .iter()
                .any(|p| p.source_id == c.source_id && p.text == c.text)
            {
                continue;
            }
            pool.push(c);
        }
        if pool.len() == before {
            return "No new passages matched that query. Try a different query, or give your \
                    final answer (say you could not find it if the documents do not cover it)."
                .to_string();
        }
        let mut s = String::from("Retrieved passages:\n");
        for (i, c) in pool.iter().enumerate().skip(before) {
            let _ = writeln!(
                s,
                "[{}] {}: {}",
                i + 1,
                c.title,
                truncate(&c.text, self.cfg.passage_chars)
            );
        }
        s.push_str(
            "\nSearch again to gather more, or give your final answer citing passages by number.",
        );
        s
    }
}

/// Extract the model's JSON action from a reply, tolerating stray prose or
/// ```json fences by falling back to the outermost `{…}` span.
fn parse_action(reply: &str) -> Option<Value> {
    let trimmed = reply.trim();
    if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
        if v.is_object() {
            return Some(v);
        }
    }
    let start = reply.find('{')?;
    let end = reply.rfind('}')?;
    if end > start {
        let candidate = &reply[start..=end];
        if let Ok(v) = serde_json::from_str::<Value>(candidate) {
            if v.is_object() {
                return Some(v);
            }
        }
    }
    None
}

/// Collect citations from the `citations` number array plus any inline `[n]`
/// markers in the text, 1-based into `pool`, deduped and in first-use order.
fn collect_citations(action: &Value, text: &str, pool: &[AnswerContext]) -> Vec<Citation> {
    let mut nums: Vec<usize> = Vec::new();
    if let Some(arr) = action.get("citations").and_then(Value::as_array) {
        for v in arr {
            if let Some(n) = v.as_u64() {
                nums.push(n as usize);
            }
        }
    }
    nums.extend(inline_markers(text));

    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for n in nums {
        if n >= 1 && n <= pool.len() && seen.insert(n) {
            out.push(Citation {
                context_index: n - 1,
                source_id: pool[n - 1].source_id.clone(),
            });
        }
    }
    out
}

/// Parse inline `[n]` markers into 1-based numbers, in appearance order.
fn inline_markers(text: &str) -> Vec<usize> {
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'[' {
            let mut j = i + 1;
            while j < bytes.len() && bytes[j].is_ascii_digit() {
                j += 1;
            }
            if j > i + 1 && j < bytes.len() && bytes[j] == b']' {
                if let Ok(n) = text[i + 1..j].parse::<usize>() {
                    out.push(n);
                }
                i = j + 1;
                continue;
            }
        }
        i += 1;
    }
    out
}

/// Truncate to at most `max` chars on a char boundary, appending `…` if cut.
fn truncate(s: &str, max: usize) -> String {
    let flat: String = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= max {
        return flat;
    }
    let mut t: String = flat.chars().take(max).collect();
    t.push('…');
    t
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::Mutex;

    /// A chat model that replays scripted replies in order.
    struct ScriptedChat {
        replies: Mutex<VecDeque<String>>,
    }
    impl ScriptedChat {
        fn new<I: IntoIterator<Item = &'static str>>(replies: I) -> Self {
            Self {
                replies: Mutex::new(replies.into_iter().map(String::from).collect()),
            }
        }
    }
    #[async_trait]
    impl ChatModel for ScriptedChat {
        async fn chat(&self, _messages: &[ChatMessage]) -> Result<String, AiError> {
            Ok(self
                .replies
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or_else(|| r#"{"action":"answer","text":"","citations":[]}"#.to_string()))
        }
    }

    fn ctx(id: &str, title: &str, text: &str) -> AnswerContext {
        AnswerContext {
            source_id: id.into(),
            title: title.into(),
            text: text.into(),
        }
    }

    /// A retriever returning canned passages when the query contains a keyword.
    struct CannedRetriever {
        table: Vec<(&'static str, Vec<AnswerContext>)>,
    }
    #[async_trait]
    impl Retriever for CannedRetriever {
        async fn retrieve(&self, query: &str, _k: usize) -> Result<Vec<AnswerContext>, AiError> {
            let q = query.to_lowercase();
            for (kw, passages) in &self.table {
                if q.contains(kw) {
                    return Ok(passages.clone());
                }
            }
            Ok(Vec::new())
        }
    }

    #[tokio::test]
    async fn searches_then_answers_with_citation() {
        let chat = ScriptedChat::new([
            r#"{"action":"search","query":"revenue recognition"}"#,
            r#"{"action":"answer","text":"Revenue is recognized on delivery [1].","citations":[1]}"#,
        ]);
        let retriever = CannedRetriever {
            table: vec![(
                "revenue",
                vec![ctx("f1", "Finance", "Revenue is recognized on delivery.")],
            )],
        };
        let out = Agent::new(&chat, &retriever)
            .run("when is revenue recognized?")
            .await
            .unwrap();
        assert!(out.answer.contains("delivery"));
        assert_eq!(out.searches, vec!["revenue recognition".to_string()]);
        assert_eq!(out.citations.len(), 1);
        assert_eq!(out.citations[0].source_id, "f1");
        assert_eq!(out.citations[0].context_index, 0);
        assert_eq!(out.contexts.len(), 1);
    }

    #[tokio::test]
    async fn multi_hop_accumulates_pool_and_numbers_globally() {
        // Two searches; the answer cites a passage from the second batch by its
        // global number [2].
        let chat = ScriptedChat::new([
            r#"{"action":"search","query":"revenue"}"#,
            r#"{"action":"search","query":"refund policy"}"#,
            r#"{"action":"answer","text":"Refunds are issued within 30 days [2].","citations":[2]}"#,
        ]);
        let retriever = CannedRetriever {
            table: vec![
                (
                    "revenue",
                    vec![ctx("f1", "Finance", "Revenue on delivery.")],
                ),
                (
                    "refund",
                    vec![ctx("f2", "Policy", "Refunds are issued within 30 days.")],
                ),
            ],
        };
        let out = Agent::new(&chat, &retriever)
            .run("what is the refund window?")
            .await
            .unwrap();
        assert_eq!(out.contexts.len(), 2);
        assert_eq!(out.searches.len(), 2);
        assert_eq!(out.citations.len(), 1);
        assert_eq!(out.citations[0].context_index, 1);
        assert_eq!(out.citations[0].source_id, "f2");
    }

    #[tokio::test]
    async fn recovers_from_invalid_json() {
        let chat = ScriptedChat::new([
            "let me think about this first",
            r#"{"action":"search","query":"revenue"}"#,
            r#"{"action":"answer","text":"On delivery [1].","citations":[1]}"#,
        ]);
        let retriever = CannedRetriever {
            table: vec![(
                "revenue",
                vec![ctx("f1", "Finance", "Revenue on delivery.")],
            )],
        };
        let out = Agent::new(&chat, &retriever).run("when?").await.unwrap();
        assert!(out.answer.contains("delivery"));
        assert_eq!(out.citations.len(), 1);
    }

    #[tokio::test]
    async fn inline_markers_without_citations_array_are_parsed() {
        let chat = ScriptedChat::new([
            r#"{"action":"search","query":"revenue"}"#,
            r#"{"action":"answer","text":"On delivery [1]."}"#,
        ]);
        let retriever = CannedRetriever {
            table: vec![(
                "revenue",
                vec![ctx("f1", "Finance", "Revenue on delivery.")],
            )],
        };
        let out = Agent::new(&chat, &retriever).run("when?").await.unwrap();
        assert_eq!(out.citations.len(), 1);
        assert_eq!(out.citations[0].source_id, "f1");
    }

    #[tokio::test]
    async fn no_results_yields_uncited_answer() {
        let chat = ScriptedChat::new([
            r#"{"action":"search","query":"quantum chromodynamics"}"#,
            r#"{"action":"answer","text":"I could not find that in the documents.","citations":[]}"#,
        ]);
        let retriever = CannedRetriever { table: vec![] };
        let out = Agent::new(&chat, &retriever)
            .run("explain qcd")
            .await
            .unwrap();
        assert!(out.contexts.is_empty());
        assert!(out.citations.is_empty());
        assert!(out.answer.contains("could not find"));
    }

    #[tokio::test]
    async fn out_of_range_citation_is_dropped() {
        let chat = ScriptedChat::new([
            r#"{"action":"search","query":"revenue"}"#,
            r#"{"action":"answer","text":"See [9].","citations":[9]}"#,
        ]);
        let retriever = CannedRetriever {
            table: vec![(
                "revenue",
                vec![ctx("f1", "Finance", "Revenue on delivery.")],
            )],
        };
        let out = Agent::new(&chat, &retriever).run("when?").await.unwrap();
        assert!(out.citations.is_empty());
    }

    #[tokio::test]
    async fn exhausting_steps_returns_empty_answer() {
        // Model only ever searches; the loop must terminate with an empty answer.
        let chat = ScriptedChat::new([
            r#"{"action":"search","query":"revenue"}"#,
            r#"{"action":"search","query":"revenue"}"#,
        ]);
        let retriever = CannedRetriever {
            table: vec![(
                "revenue",
                vec![ctx("f1", "Finance", "Revenue on delivery.")],
            )],
        };
        let cfg = AgentConfig {
            max_steps: 2,
            ..AgentConfig::default()
        };
        let out = Agent::new(&chat, &retriever)
            .with_config(cfg)
            .run("when?")
            .await
            .unwrap();
        assert!(out.answer.is_empty());
        assert_eq!(out.searches.len(), 2);
    }

    #[tokio::test]
    async fn empty_question_short_circuits() {
        let chat = ScriptedChat::new([]);
        let retriever = CannedRetriever { table: vec![] };
        let out = Agent::new(&chat, &retriever).run("   ").await.unwrap();
        assert!(out.answer.is_empty());
        assert!(out.searches.is_empty());
    }

    #[test]
    fn parse_action_tolerates_fences_and_prose() {
        let v = parse_action("```json\n{\"action\":\"search\",\"query\":\"x\"}\n```").unwrap();
        assert_eq!(v["action"], "search");
        let v = parse_action("Sure! {\"action\":\"answer\",\"text\":\"hi\"} done").unwrap();
        assert_eq!(v["action"], "answer");
        assert!(parse_action("no json here").is_none());
    }
}
