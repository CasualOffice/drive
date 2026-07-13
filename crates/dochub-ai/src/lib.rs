//! `dochub-ai` — retrieval-augmented-generation primitives for Doc-Hub.
//!
//! Phase 5 foundation: the pure, offline, unit-testable building blocks of the
//! RAG pipeline, with no storage, network, or DB dependency (mirroring how
//! `dochub-index` is a pure search primitive and `dochub-worker` a pure runtime).
//! The pipeline that composes them —
//!
//! ```text
//! extracted text ──chunk──▶ chunks ──embed──▶ vectors ──store──▶ (embeddings table)
//!                                    query ──embed──▶ vector ──top_k──▶ ranked chunks
//! ```
//!
//! — is wired one layer up: an `embed_file` job (riding the same `dochub-worker`
//! queue as `index_file`) chunks + embeds a committed head and persists the
//! vectors; a semantic-search / Q&A endpoint embeds the query and retrieves.
//! Those land in follow-up PRs; this crate is the substrate they build on.
//!
//! Provider-agnostic by design (CLAUDE.md: pluggable LLM provider + local
//! option): [`Embedder`] is a trait, and [`LocalEmbedder`] is the offline
//! baseline that keeps the whole pipeline self-hostable and test-drivable
//! without a network. A hosted semantic embedder slots in behind the same trait.

#![forbid(unsafe_code)]

pub mod agent;
pub mod answer;
pub mod chunk;
pub mod embed;
pub mod remote;
pub mod retrieve;

pub use agent::{Agent, AgentConfig, AgentOutcome, Retriever};
pub use answer::{Answer, AnswerContext, Answerer, Citation, ExtractiveAnswerer};
pub use chunk::{chunk_text, Chunk, ChunkConfig};
pub use embed::{AiError, Embedder, Embedding, LocalEmbedder};
pub use remote::{ChatMessage, ChatModel, Provider, RemoteAnswerer};
pub use retrieve::{cosine, top_k, Scored};

#[cfg(test)]
mod tests {
    //! End-to-end: chunk → embed → retrieve, proving the pieces compose into a
    //! working retrieval over the offline embedder.
    use super::*;

    #[tokio::test]
    async fn chunk_embed_retrieve_finds_the_relevant_passage() {
        let doc = "\
            The onboarding guide explains how to reset your password. \
            Separately, the finance section covers quarterly revenue recognition \
            and the rules for deferred subscription income. \
            A final appendix lists office locations and building access hours.";

        let cfg = ChunkConfig {
            max_chars: 90,
            overlap_chars: 20,
        };
        let chunks = chunk_text(doc, &cfg);
        assert!(chunks.len() >= 2, "doc should split into several chunks");

        let embedder = LocalEmbedder::default();
        let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
        let vectors = embedder.embed(&texts).await.unwrap();

        let candidates: Vec<(usize, Embedding)> =
            chunks.iter().map(|c| c.index).zip(vectors).collect();

        // A query about revenue should retrieve the finance chunk.
        let q = embedder
            .embed_one("rules for recognizing quarterly revenue")
            .await
            .unwrap();
        let hits = top_k(&q, &candidates, 1, f32::MIN);
        assert_eq!(hits.len(), 1);
        let best = &chunks[hits[0].item];
        assert!(
            best.text.contains("revenue"),
            "top hit should be the finance passage, got: {:?}",
            best.text
        );
    }
}
