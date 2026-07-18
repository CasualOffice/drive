//! Hosted LLM — provider-agnostic chat + answerer over the retrieved passages.
//!
//! Two capabilities sit on one configurable transport:
//! - [`ChatModel`] — a raw multi-turn chat (system/user/assistant turns → reply
//!   text). This is what the [`crate::agent`] ReAct loop drives.
//! - [`Answerer`] — the single-shot RAG counterpart to
//!   [`crate::answer::ExtractiveAnswerer`]: it asks the model to write an answer
//!   grounded in numbered passages and cite them inline as `[n]`.
//!
//! Both pick the provider purely by config; the offline extractive answerer
//! stays the default and the air-gapped path.
//!
//! **Not tied to one vendor.** [`Provider`] covers the two dominant wire
//! formats:
//! - [`Provider::Anthropic`] — Claude via the Messages API.
//! - [`Provider::OpenAi`] — the Chat Completions API, which is also spoken by
//!   OpenAI *and* local model servers (Ollama, LM Studio, vLLM, …) via their
//!   OpenAI-compatible endpoints. Point `base_url` at `localhost` for a local
//!   model, at `api.openai.com/v1` for ChatGPT.
//!
//! Only the network round-trip needs a live server; the request builders,
//! response extractor, and citation parser are pure and unit-tested per
//! provider. Grounding is enforced by the system prompt ("use ONLY the provided
//! passages"), so answers trace back to cited documents.

use std::collections::HashSet;
use std::fmt::Write as _;

use async_trait::async_trait;
use serde_json::{json, Value};

use crate::answer::{Answer, AnswerContext, Answerer, Citation};
use crate::embed::AiError;

const ANTHROPIC_VERSION: &str = "2023-06-01";
const DEFAULT_MAX_TOKENS: u32 = 1024;

/// Cap on a single provider request. Generous for long (non-streaming)
/// generations, but bounds a hung / black-holed endpoint — a bare
/// `reqwest::Client` has NO default timeout, so without this an unresponsive
/// AI endpoint would hang the calling request (and its DB/worker slot) forever.
const REQUEST_TIMEOUT_SECS: u64 = 120;
/// Cap on just the TCP+TLS connect, so an unroutable endpoint fails fast.
const CONNECT_TIMEOUT_SECS: u64 = 10;

const SYSTEM_PROMPT: &str = "You are a document assistant for a company's private \
document hub. Answer the user's question using ONLY the numbered context \
passages provided. Cite the passages you rely on inline as [n] (matching the \
passage numbers). If the passages do not contain the answer, say you could not \
find it in the documents. Be concise and do not invent facts.";

/// A role in a chat exchange.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    System,
    User,
    Assistant,
}

impl Role {
    fn as_str(self) -> &'static str {
        match self {
            Self::System => "system",
            Self::User => "user",
            Self::Assistant => "assistant",
        }
    }
}

/// One turn in a chat exchange.
#[derive(Debug, Clone)]
pub struct ChatMessage {
    pub role: Role,
    pub content: String,
}

impl ChatMessage {
    pub fn system(content: impl Into<String>) -> Self {
        Self {
            role: Role::System,
            content: content.into(),
        }
    }
    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: Role::User,
            content: content.into(),
        }
    }
    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: Role::Assistant,
            content: content.into(),
        }
    }
}

/// A provider-agnostic multi-turn chat model. The [`crate::agent`] loop drives
/// this: it appends the model's replies and its own tool observations as turns
/// and calls [`ChatModel::chat`] again until the model emits a final answer.
#[async_trait]
pub trait ChatModel: Send + Sync {
    /// Send the conversation so far and return the model's next reply text.
    async fn chat(&self, messages: &[ChatMessage]) -> Result<String, AiError>;
}

/// LLM wire format. `OpenAi` also covers local OpenAI-compatible servers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    Anthropic,
    OpenAi,
}

impl Provider {
    /// Parse a config string (`anthropic` | `claude`, `openai` | `chatgpt`,
    /// `local`). `local` maps to the OpenAI wire format (the de-facto standard
    /// for self-hosted model servers).
    #[must_use]
    pub fn from_name(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "anthropic" | "claude" => Some(Self::Anthropic),
            "openai" | "chatgpt" | "gpt" | "local" | "ollama" => Some(Self::OpenAi),
            _ => None,
        }
    }

    fn default_base_url(self) -> &'static str {
        match self {
            Self::Anthropic => "https://api.anthropic.com",
            Self::OpenAi => "https://api.openai.com/v1",
        }
    }

    fn default_model(self) -> &'static str {
        match self {
            Self::Anthropic => "claude-sonnet-5",
            Self::OpenAi => "gpt-4o-mini",
        }
    }
}

/// Hosted LLM client backed by a configurable provider. Implements both
/// [`ChatModel`] (raw chat, for the agent) and [`Answerer`] (single-shot RAG).
#[derive(Debug, Clone)]
pub struct RemoteAnswerer {
    client: reqwest::Client,
    provider: Provider,
    /// Optional — a local model server may need no key.
    api_key: Option<String>,
    model: String,
    base_url: String,
    max_tokens: u32,
}

impl RemoteAnswerer {
    /// Build for `provider` with its default model/base-url. Set the key with
    /// [`Self::with_api_key`] (or leave unset for a keyless local server).
    #[must_use]
    pub fn new(provider: Provider) -> Self {
        Self {
            // Mirror `reqwest::Client::new()` (which `.expect()`s the builder) —
            // a timeout-only config can't fail to build in practice.
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
                .connect_timeout(std::time::Duration::from_secs(CONNECT_TIMEOUT_SECS))
                .build()
                .expect("reqwest client with timeout"),
            provider,
            api_key: None,
            model: provider.default_model().to_string(),
            base_url: provider.default_base_url().to_string(),
            max_tokens: DEFAULT_MAX_TOKENS,
        }
    }

    #[must_use]
    pub fn with_api_key(mut self, key: impl Into<String>) -> Self {
        self.api_key = Some(key.into());
        self
    }

    #[must_use]
    pub fn with_model(mut self, model: impl Into<String>) -> Self {
        self.model = model.into();
        self
    }

    #[must_use]
    pub fn with_base_url(mut self, base_url: impl Into<String>) -> Self {
        self.base_url = base_url.into();
        self
    }

    #[must_use]
    pub fn with_max_tokens(mut self, max_tokens: u32) -> Self {
        self.max_tokens = max_tokens;
        self
    }

    /// Construct from the environment. Returns `None` when `DOCHUB_AI_PROVIDER`
    /// is unset/unknown (caller falls back to the offline answerer).
    ///
    /// - `DOCHUB_AI_PROVIDER` — `anthropic` | `openai` | `local` (aliases: claude,
    ///   chatgpt, ollama).
    /// - `DOCHUB_AI_API_KEY` — key (falls back to `ANTHROPIC_API_KEY` /
    ///   `OPENAI_API_KEY`); optional for a local server.
    /// - `DOCHUB_AI_MODEL` — model id (per-provider default otherwise).
    /// - `DOCHUB_AI_BASE_URL` — override the API base (required for a local
    ///   server, e.g. `http://localhost:11434/v1`).
    #[must_use]
    pub fn from_env() -> Option<Self> {
        let provider = Provider::from_name(&std::env::var("DOCHUB_AI_PROVIDER").ok()?)?;
        let mut a = Self::new(provider);

        let key = env_nonempty("DOCHUB_AI_API_KEY").or_else(|| match provider {
            Provider::Anthropic => env_nonempty("ANTHROPIC_API_KEY"),
            Provider::OpenAi => env_nonempty("OPENAI_API_KEY"),
        });
        a.api_key = key;
        if let Some(m) = env_nonempty("DOCHUB_AI_MODEL") {
            a.model = m;
        }
        if let Some(u) = env_nonempty("DOCHUB_AI_BASE_URL") {
            a.base_url = u;
        }
        Some(a)
    }

    fn endpoint(&self) -> String {
        match self.provider {
            Provider::Anthropic => format!("{}/v1/messages", self.base_url),
            Provider::OpenAi => format!("{}/chat/completions", self.base_url),
        }
    }

    /// Send a chat request and return the reply text. The single network path
    /// shared by [`ChatModel::chat`] and [`Answerer::answer`].
    async fn send_chat(&self, messages: &[ChatMessage]) -> Result<String, AiError> {
        let body = match self.provider {
            Provider::Anthropic => anthropic_body(&self.model, self.max_tokens, messages),
            Provider::OpenAi => openai_body(&self.model, self.max_tokens, messages),
        };

        let mut req = self.client.post(self.endpoint()).json(&body);
        req = match self.provider {
            Provider::Anthropic => {
                let key = self.api_key.as_deref().unwrap_or_default();
                req.header("x-api-key", key)
                    .header("anthropic-version", ANTHROPIC_VERSION)
            }
            Provider::OpenAi => match &self.api_key {
                Some(k) => req.header("authorization", format!("Bearer {k}")),
                None => req, // keyless local server
            },
        };

        let resp = req
            .send()
            .await
            .map_err(|e| AiError::Provider(e.to_string()))?;
        let status = resp.status();
        let json: Value = resp
            .json()
            .await
            .map_err(|e| AiError::Provider(format!("decoding response: {e}")))?;
        if !status.is_success() {
            return Err(AiError::Provider(format!(
                "{:?} {status}: {}",
                self.provider,
                error_message(&json)
            )));
        }

        Ok(match self.provider {
            Provider::Anthropic => anthropic_text(&json),
            Provider::OpenAi => openai_text(&json),
        })
    }
}

#[async_trait]
impl ChatModel for RemoteAnswerer {
    async fn chat(&self, messages: &[ChatMessage]) -> Result<String, AiError> {
        if messages.is_empty() {
            return Ok(String::new());
        }
        self.send_chat(messages).await
    }
}

#[async_trait]
impl Answerer for RemoteAnswerer {
    async fn answer(&self, question: &str, contexts: &[AnswerContext]) -> Result<Answer, AiError> {
        if question.trim().is_empty() || contexts.is_empty() {
            return Ok(Answer {
                text: String::new(),
                citations: Vec::new(),
            });
        }

        let messages = [
            ChatMessage::system(SYSTEM_PROMPT),
            ChatMessage::user(user_prompt(question, contexts)),
        ];
        let text = self.send_chat(&messages).await?;
        let citations = parse_citations(&text, contexts.len(), contexts);
        Ok(Answer { text, citations })
    }
}

fn env_nonempty(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|s| !s.trim().is_empty())
}

/// The user turn for single-shot RAG: the question + numbered passages.
fn user_prompt(question: &str, contexts: &[AnswerContext]) -> String {
    let mut passages = String::new();
    for (i, c) in contexts.iter().enumerate() {
        let _ = write!(passages, "[{}] {}: {}\n\n", i + 1, c.title, c.text);
    }
    format!(
        "Question: {question}\n\nContext passages:\n{passages}Answer using only these passages and cite them as [n]."
    )
}

/// Anthropic Messages API request body. Pure — unit-tested. Consecutive
/// `system` turns are hoisted into the top-level `system` field; the rest map to
/// `messages`.
fn anthropic_body(model: &str, max_tokens: u32, messages: &[ChatMessage]) -> Value {
    let system = messages
        .iter()
        .filter(|m| m.role == Role::System)
        .map(|m| m.content.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");
    let turns: Vec<Value> = messages
        .iter()
        .filter(|m| m.role != Role::System)
        .map(|m| json!({ "role": m.role.as_str(), "content": m.content }))
        .collect();
    json!({
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": turns,
    })
}

/// OpenAI Chat Completions request body (also for local servers). Pure —
/// system turns stay inline as `system` messages.
fn openai_body(model: &str, max_tokens: u32, messages: &[ChatMessage]) -> Value {
    let turns: Vec<Value> = messages
        .iter()
        .map(|m| json!({ "role": m.role.as_str(), "content": m.content }))
        .collect();
    json!({
        "model": model,
        "max_tokens": max_tokens,
        "messages": turns,
    })
}

/// Concatenate the text blocks of an Anthropic response. Pure.
fn anthropic_text(json: &Value) -> String {
    json.get("content")
        .and_then(Value::as_array)
        .map(|blocks| {
            blocks
                .iter()
                .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
                .filter_map(|b| b.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default()
}

/// Extract `choices[0].message.content` from an OpenAI response. Pure.
fn openai_text(json: &Value) -> String {
    json.get("choices")
        .and_then(Value::as_array)
        .and_then(|c| c.first())
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

/// Best-effort error message from either provider's error envelope.
fn error_message(json: &Value) -> String {
    json.get("error")
        .and_then(|e| e.get("message").or(Some(e)))
        .and_then(Value::as_str)
        .unwrap_or("unknown error")
        .to_string()
}

/// Parse inline `[n]` markers (1-based) into citations, in first-appearance
/// order, ignoring out-of-range numbers. Pure — unit-tested.
fn parse_citations(text: &str, n_contexts: usize, contexts: &[AnswerContext]) -> Vec<Citation> {
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'[' {
            let mut j = i + 1;
            while j < bytes.len() && bytes[j].is_ascii_digit() {
                j += 1;
            }
            if j > i + 1 && j < bytes.len() && bytes[j] == b']' {
                if let Ok(num) = text[i + 1..j].parse::<usize>() {
                    if num >= 1 && num <= n_contexts && seen.insert(num) {
                        let idx = num - 1;
                        out.push(Citation {
                            context_index: idx,
                            source_id: contexts[idx].source_id.clone(),
                        });
                    }
                }
                i = j + 1;
                continue;
            }
        }
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(id: &str, title: &str, text: &str) -> AnswerContext {
        AnswerContext {
            source_id: id.into(),
            title: title.into(),
            text: text.into(),
        }
    }

    #[test]
    fn provider_parsing_covers_aliases() {
        assert_eq!(Provider::from_name("claude"), Some(Provider::Anthropic));
        assert_eq!(Provider::from_name("ChatGPT"), Some(Provider::OpenAi));
        assert_eq!(Provider::from_name("local"), Some(Provider::OpenAi));
        assert_eq!(Provider::from_name("ollama"), Some(Provider::OpenAi));
        assert_eq!(Provider::from_name("nope"), None);
    }

    #[test]
    fn endpoints_differ_by_provider() {
        let a = RemoteAnswerer::new(Provider::Anthropic);
        assert_eq!(a.endpoint(), "https://api.anthropic.com/v1/messages");
        let o = RemoteAnswerer::new(Provider::OpenAi).with_base_url("http://localhost:11434/v1");
        assert_eq!(o.endpoint(), "http://localhost:11434/v1/chat/completions");
    }

    #[test]
    fn anthropic_body_hoists_system_and_keeps_turns() {
        let msgs = [
            ChatMessage::system("be terse"),
            ChatMessage::user("hi"),
            ChatMessage::assistant("hello"),
            ChatMessage::user("again"),
        ];
        let b = anthropic_body("claude-sonnet-5", 1024, &msgs);
        assert_eq!(b["model"], "claude-sonnet-5");
        assert_eq!(b["system"], "be terse");
        // System turn is not in `messages`; the other three are, in order.
        assert_eq!(b["messages"].as_array().unwrap().len(), 3);
        assert_eq!(b["messages"][0]["role"], "user");
        assert_eq!(b["messages"][1]["role"], "assistant");
        assert_eq!(b["messages"][2]["content"], "again");
    }

    #[test]
    fn openai_body_keeps_system_inline() {
        let msgs = [ChatMessage::system("be terse"), ChatMessage::user("hi")];
        let b = openai_body("gpt-4o-mini", 1024, &msgs);
        assert_eq!(b["messages"][0]["role"], "system");
        assert_eq!(b["messages"][1]["role"], "user");
        assert_eq!(b["messages"][1]["content"], "hi");
    }

    #[test]
    fn answer_user_prompt_numbers_passages() {
        let c = vec![ctx("f1", "Finance", "Revenue is recognized on delivery.")];
        let p = user_prompt("when?", &c);
        assert!(p.contains("[1] Finance: Revenue is recognized on delivery."));
    }

    #[test]
    fn extracts_text_from_each_provider_shape() {
        let anth = json!({ "content": [
            { "type": "text", "text": "Recognized on delivery [1]." },
            { "type": "thinking", "text": "ignored" },
        ]});
        assert_eq!(anthropic_text(&anth), "Recognized on delivery [1].");

        let oai = json!({ "choices": [ { "message": { "role": "assistant", "content": "Recognized on delivery [1]." } } ]});
        assert_eq!(openai_text(&oai), "Recognized on delivery [1].");
    }

    #[test]
    fn parses_in_range_citations_in_order_deduped() {
        let c = vec![
            ctx("f1", "A", "x"),
            ctx("f2", "B", "y"),
            ctx("f3", "C", "z"),
        ];
        let cites = parse_citations("see [2] and [1], again [2], bad [9]", 3, &c);
        assert_eq!(cites.len(), 2);
        assert_eq!(cites[0].source_id, "f2");
        assert_eq!(cites[1].source_id, "f1");
    }

    #[tokio::test]
    async fn empty_question_or_contexts_skips_network() {
        let a = RemoteAnswerer::new(Provider::OpenAi).with_api_key("k");
        assert!(a.answer("", &[]).await.unwrap().text.is_empty());
        assert!(a.answer("q", &[]).await.unwrap().citations.is_empty());
    }

    #[tokio::test]
    async fn empty_messages_skip_network() {
        let a = RemoteAnswerer::new(Provider::OpenAi).with_api_key("k");
        assert!(a.chat(&[]).await.unwrap().is_empty());
    }
}
