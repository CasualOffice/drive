//! Answer composition — the generation half of RAG.
//!
//! Retrieval (chunk → embed → `top_k`) finds the passages most relevant to a
//! question; an [`Answerer`] turns those passages + the question into a written
//! answer with citations back to the source chunks. The trait keeps generation
//! provider-agnostic (CLAUDE.md: pluggable LLM provider + local option).
//!
//! This crate ships the **offline baseline**, [`ExtractiveAnswerer`]: it selects
//! the sentences across the retrieved contexts that best overlap the question
//! and stitches them into a short answer, citing every context a chosen
//! sentence came from. It invents nothing (purely extractive), is deterministic,
//! and needs no network — so the whole RAG loop is testable and self-hostable. A
//! hosted, abstractive model (e.g. Claude) slots in behind the same trait.

use async_trait::async_trait;

use crate::embed::AiError;

/// One retrieved passage handed to an [`Answerer`], with a stable `source_id`
/// (the file id) the citation refers back to.
#[derive(Debug, Clone)]
pub struct AnswerContext {
    /// Stable id of the source document (echoed in [`Citation::source_id`]).
    pub source_id: String,
    /// Human title of the source, for display.
    pub title: String,
    /// The passage text.
    pub text: String,
}

/// A citation: which retrieved context supported the answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Citation {
    /// Index into the `contexts` slice passed to [`Answerer::answer`].
    pub context_index: usize,
    /// The source document id (`AnswerContext::source_id`).
    pub source_id: String,
}

/// A composed answer with the citations that support it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Answer {
    /// The answer text. Empty when the contexts don't address the question.
    pub text: String,
    /// Sources the answer drew from, in order of first use. Empty for an empty
    /// answer.
    pub citations: Vec<Citation>,
}

/// Composes an [`Answer`] to `question` from retrieved `contexts`.
#[async_trait]
pub trait Answerer: Send + Sync {
    /// Answer `question` using only `contexts`. Implementations must not invent
    /// facts beyond the contexts, and should cite the contexts they use.
    async fn answer(&self, question: &str, contexts: &[AnswerContext]) -> Result<Answer, AiError>;
}

/// Offline, deterministic, purely **extractive** answerer: it ranks the
/// sentences in the contexts by word overlap with the question and returns the
/// best few, citing their sources. The default answerer for self-hosted /
/// air-gapped installs and every test.
#[derive(Debug, Clone)]
pub struct ExtractiveAnswerer {
    /// Maximum sentences to include in the answer.
    max_sentences: usize,
}

impl ExtractiveAnswerer {
    #[must_use]
    pub fn new(max_sentences: usize) -> Self {
        Self {
            max_sentences: max_sentences.max(1),
        }
    }
}

impl Default for ExtractiveAnswerer {
    fn default() -> Self {
        Self::new(3)
    }
}

#[async_trait]
impl Answerer for ExtractiveAnswerer {
    async fn answer(&self, question: &str, contexts: &[AnswerContext]) -> Result<Answer, AiError> {
        let q_terms = term_set(question);
        if q_terms.is_empty() || contexts.is_empty() {
            return Ok(Answer {
                text: String::new(),
                citations: Vec::new(),
            });
        }

        // Score every sentence in every context by question-term overlap.
        struct Scored {
            ctx: usize,
            order: usize,
            sentence: String,
            score: usize,
        }
        let mut scored: Vec<Scored> = Vec::new();
        for (ci, ctx) in contexts.iter().enumerate() {
            for (si, sentence) in split_sentences(&ctx.text).into_iter().enumerate() {
                let overlap = term_set(&sentence).intersection(&q_terms).count();
                if overlap > 0 {
                    scored.push(Scored {
                        ctx: ci,
                        order: si,
                        sentence,
                        score: overlap,
                    });
                }
            }
        }

        if scored.is_empty() {
            return Ok(Answer {
                text: String::new(),
                citations: Vec::new(),
            });
        }

        // Best overlap first; ties keep source order (context, then sentence) so
        // the result is deterministic.
        scored.sort_by(|a, b| {
            b.score
                .cmp(&a.score)
                .then(a.ctx.cmp(&b.ctx))
                .then(a.order.cmp(&b.order))
        });
        scored.truncate(self.max_sentences);
        // Re-order the chosen sentences back into document order (context, then
        // sentence position) so the answer reads naturally.
        scored.sort_by(|a, b| a.ctx.cmp(&b.ctx).then(a.order.cmp(&b.order)));

        let text = scored
            .iter()
            .map(|s| s.sentence.clone())
            .collect::<Vec<_>>()
            .join(" ");

        // Cite each distinct context used, in order of first appearance.
        let mut citations: Vec<Citation> = Vec::new();
        for s in &scored {
            if !citations.iter().any(|c| c.context_index == s.ctx) {
                citations.push(Citation {
                    context_index: s.ctx,
                    source_id: contexts[s.ctx].source_id.clone(),
                });
            }
        }

        Ok(Answer { text, citations })
    }
}

/// Lowercase alphanumeric terms of length >= 2 (stopword-agnostic, matching the
/// embedder's tokenizer closely enough for overlap scoring).
fn term_set(text: &str) -> std::collections::HashSet<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.len() >= 2)
        .map(str::to_lowercase)
        .collect()
}

/// Split text into sentences on `.`, `!`, `?`, and newlines. Whitespace is
/// collapsed and empty fragments dropped.
fn split_sentences(text: &str) -> Vec<String> {
    text.split(['.', '!', '?', '\n'])
        .map(|s| s.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|s| !s.is_empty())
        .collect()
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

    #[tokio::test]
    async fn extracts_relevant_sentence_and_cites_source() {
        let contexts = vec![
            ctx(
                "f1",
                "Finance",
                "The office is open on weekdays. Quarterly revenue is recognized when the service is delivered. Parking is free.",
            ),
            ctx("f2", "Recipes", "Sourdough needs rye flour and a wild yeast starter."),
        ];
        let a = ExtractiveAnswerer::new(1);
        let ans = a
            .answer("when is revenue recognized?", &contexts)
            .await
            .unwrap();
        assert!(ans.text.contains("revenue is recognized"));
        assert_eq!(ans.citations.len(), 1);
        assert_eq!(ans.citations[0].source_id, "f1");
        assert_eq!(ans.citations[0].context_index, 0);
    }

    #[tokio::test]
    async fn no_overlap_yields_empty_answer() {
        let contexts = vec![ctx(
            "f1",
            "T",
            "completely unrelated content about gardening",
        )];
        let ans = ExtractiveAnswerer::default()
            .answer("quantum chromodynamics", &contexts)
            .await
            .unwrap();
        assert!(ans.text.is_empty());
        assert!(ans.citations.is_empty());
    }

    #[tokio::test]
    async fn empty_question_or_contexts_is_empty() {
        let a = ExtractiveAnswerer::default();
        assert!(a.answer("", &[]).await.unwrap().text.is_empty());
        assert!(a
            .answer("anything", &[])
            .await
            .unwrap()
            .citations
            .is_empty());
    }

    #[tokio::test]
    async fn multi_sentence_answer_dedups_citations_in_order() {
        let contexts = vec![
            ctx(
                "f1",
                "A",
                "Budget covers travel. Budget also covers marketing.",
            ),
            ctx("f2", "B", "The budget report is due friday."),
        ];
        let ans = ExtractiveAnswerer::new(3)
            .answer("what does the budget cover?", &contexts)
            .await
            .unwrap();
        // Two contexts contributed; each cited once, in first-use order.
        assert_eq!(ans.citations.len(), 2);
        assert_eq!(ans.citations[0].source_id, "f1");
        assert_eq!(ans.citations[1].source_id, "f2");
        assert!(ans.text.to_lowercase().contains("budget"));
    }
}
