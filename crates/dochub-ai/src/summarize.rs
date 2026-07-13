//! Document summarization — condense a document's text into a few sentences,
//! behind a pluggable [`Summarizer`] trait.
//!
//! Phase 5 AI capability (CLAUDE.md: "document/section summaries" as read-only
//! suggestions). Like the rest of this crate it ships an **offline baseline** —
//! [`ExtractiveSummarizer`] — that needs no network and is fully deterministic,
//! so summaries are self-hostable and test-drivable. A hosted abstractive model
//! (e.g. Claude) slots in behind the same trait later.
//!
//! The offline summarizer is **extractive** (Luhn-style, frequency-based): it
//! never invents text. It scores each sentence by the salience of the content
//! words it contains — a word's salience is how often it recurs across the
//! document, with a compact stopword list removed so "the"/"and" don't drown out
//! the topic — then returns the top few sentences **in original document order**
//! so the summary reads as a coherent excerpt rather than a reordered jumble.

use async_trait::async_trait;

use crate::embed::AiError;

/// How much summary to produce.
#[derive(Debug, Clone, Copy)]
pub struct SummaryConfig {
    /// Maximum number of sentences to return.
    pub max_sentences: usize,
}

impl Default for SummaryConfig {
    fn default() -> Self {
        Self { max_sentences: 3 }
    }
}

/// An extractive summary: the chosen sentences, and the same joined into text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Summary {
    /// The chosen sentences joined into a short paragraph. Empty for empty input.
    pub text: String,
    /// The chosen sentences, in original document order.
    pub sentences: Vec<String>,
}

/// Condenses `text` into at most `cfg.max_sentences` sentences.
#[async_trait]
pub trait Summarizer: Send + Sync {
    async fn summarize(&self, text: &str, cfg: &SummaryConfig) -> Result<Summary, AiError>;
}

/// Offline, deterministic, purely **extractive** summarizer. Selects the most
/// salient sentences by content-word frequency; invents nothing.
#[derive(Debug, Default, Clone, Copy)]
pub struct ExtractiveSummarizer;

#[async_trait]
impl Summarizer for ExtractiveSummarizer {
    async fn summarize(&self, text: &str, cfg: &SummaryConfig) -> Result<Summary, AiError> {
        Ok(summarize_extractive(text, cfg.max_sentences))
    }
}

/// The pure extractive summary — exposed for direct use and unit tests without
/// an async runtime.
pub fn summarize_extractive(text: &str, max_sentences: usize) -> Summary {
    let sentences = split_sentences(text);
    if sentences.is_empty() || max_sentences == 0 {
        return Summary {
            text: String::new(),
            sentences: Vec::new(),
        };
    }
    if sentences.len() <= max_sentences {
        return Summary {
            text: join_sentences(&sentences),
            sentences,
        };
    }

    // Document-wide content-word frequencies (stopwords excluded).
    let mut freq: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    for s in &sentences {
        for term in content_terms(s) {
            *freq.entry(term).or_insert(0) += 1;
        }
    }

    // Score each sentence: mean salience of its unique content words. Averaging
    // (not summing) keeps a long sentence from winning on length alone; a
    // sentence with no content words scores 0.
    let mut scored: Vec<(usize, f64)> = sentences
        .iter()
        .enumerate()
        .map(|(i, s)| {
            let terms: std::collections::HashSet<String> = content_terms(s).collect();
            let score = if terms.is_empty() {
                0.0
            } else {
                let total: u32 = terms
                    .iter()
                    .map(|t| freq.get(t).copied().unwrap_or(0))
                    .sum();
                let n = u32::try_from(terms.len()).unwrap_or(u32::MAX);
                f64::from(total) / f64::from(n)
            };
            (i, score)
        })
        .collect();

    // Pick the top-k by score; ties break toward the earlier sentence. Then
    // restore document order so the excerpt reads naturally.
    scored.sort_by(|a, b| {
        b.1.partial_cmp(&a.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.0.cmp(&b.0))
    });
    let mut chosen: Vec<usize> = scored.iter().take(max_sentences).map(|(i, _)| *i).collect();
    chosen.sort_unstable();

    let picked: Vec<String> = chosen.into_iter().map(|i| sentences[i].clone()).collect();
    Summary {
        text: join_sentences(&picked),
        sentences: picked,
    }
}

/// Join sentences into a paragraph, each terminated with a period.
fn join_sentences(sentences: &[String]) -> String {
    sentences
        .iter()
        .map(|s| format!("{s}."))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Split text into sentences on `.`, `!`, `?`, and newlines. Whitespace is
/// collapsed and empty fragments dropped. Mirrors the answerer's splitter.
fn split_sentences(text: &str) -> Vec<String> {
    text.split(['.', '!', '?', '\n'])
        .map(|s| s.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|s| !s.is_empty())
        .collect()
}

/// Lowercase alphanumeric content words of length >= 2, with stopwords removed.
fn content_terms(text: &str) -> impl Iterator<Item = String> + '_ {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.len() >= 2)
        .map(str::to_lowercase)
        .filter(|t| !STOPWORDS.contains(&t.as_str()))
}

/// A compact English stopword list — enough to stop function words from
/// dominating the frequency score. Deterministic and dependency-free.
const STOPWORDS: &[&str] = &[
    "the", "and", "for", "are", "but", "not", "you", "all", "any", "can", "her", "was", "one",
    "our", "out", "has", "had", "his", "how", "its", "may", "new", "now", "old", "see", "two",
    "who", "did", "get", "him", "let", "put", "say", "she", "too", "use", "that", "this", "with",
    "from", "they", "will", "would", "there", "their", "what", "which", "when", "were", "been",
    "have", "into", "your", "than", "then", "them", "these", "those", "some", "such", "only",
    "over", "also", "back", "after", "other", "before",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_salient_sentences_and_respects_the_cap() {
        let doc = "\
            The onboarding guide explains how to reset your password. \
            Revenue recognition governs how subscription revenue is recorded. \
            Deferred subscription revenue is recognized over the contract term. \
            The office has a coffee machine on the third floor.";
        let s = summarize_extractive(doc, 2);
        assert_eq!(s.sentences.len(), 2);
        // "revenue"/"subscription" recur, so the two revenue sentences win over
        // the password and coffee ones.
        assert!(s.text.to_lowercase().contains("revenue"));
        assert!(!s.text.to_lowercase().contains("coffee"));
    }

    #[test]
    fn keeps_document_order() {
        let doc = "\
            Alpha covers the budget forecast and the budget review. \
            Bravo is an unrelated aside about the weather. \
            Charlie returns to the budget forecast and budget planning.";
        let s = summarize_extractive(doc, 2);
        assert_eq!(s.sentences.len(), 2);
        // Both budget sentences chosen; Alpha must precede Charlie.
        let a = s.text.find("Alpha").expect("alpha present");
        let c = s.text.find("Charlie").expect("charlie present");
        assert!(
            a < c,
            "chosen sentences must stay in document order:\n{}",
            s.text
        );
    }

    #[test]
    fn short_text_returns_all_sentences() {
        let doc = "First point here. Second point here.";
        let s = summarize_extractive(doc, 5);
        assert_eq!(s.sentences.len(), 2);
        assert_eq!(s.text, "First point here. Second point here.");
    }

    #[test]
    fn empty_or_whitespace_returns_empty() {
        assert_eq!(summarize_extractive("", 3).sentences.len(), 0);
        assert_eq!(summarize_extractive("   \n  ", 3).text, "");
    }

    #[test]
    fn zero_cap_returns_empty() {
        assert!(summarize_extractive("Something to say. And more.", 0)
            .sentences
            .is_empty());
    }

    #[test]
    fn stopword_heavy_sentence_loses_to_content_rich_one() {
        let doc = "\
            And so it was that they had been there with them. \
            Encryption protects encryption keys and encrypted encryption backups.";
        let s = summarize_extractive(doc, 1);
        assert_eq!(s.sentences.len(), 1);
        assert!(s.text.to_lowercase().contains("encryption"));
    }

    #[tokio::test]
    async fn summarizer_trait_delegates() {
        let sizer = ExtractiveSummarizer;
        let doc = "Revenue is recognized over time. Revenue rules are strict. The lobby is blue.";
        let s = sizer
            .summarize(doc, &SummaryConfig { max_sentences: 1 })
            .await
            .unwrap();
        assert_eq!(s.sentences.len(), 1);
        assert!(s.text.to_lowercase().contains("revenue"));
    }
}
