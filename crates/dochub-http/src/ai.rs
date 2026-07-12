//! AI provider selection for the RAG endpoints.
//!
//! The answerer is chosen from the environment once and cached. Provider-
//! agnostic: set `DOCHUB_AI_PROVIDER` to `anthropic` (Claude), `openai`
//! (ChatGPT), or `local` (a self-hosted OpenAI-compatible server) — see
//! [`dochub_ai::RemoteAnswerer::from_env`]. Unset ⇒ the offline
//! [`dochub_ai::ExtractiveAnswerer`], the air-gapped default that keeps the
//! stack self-hostable and every test deterministic (no test sets the vars, so
//! tests always get the extractive answerer).

use std::sync::{Arc, OnceLock};

use dochub_ai::{Answerer, ExtractiveAnswerer, RemoteAnswerer};

/// The configured RAG answerer, resolved once from the environment. Shared by
/// the `ask` endpoint and the MCP `ask` tool so they answer identically.
pub(crate) fn answerer() -> Arc<dyn Answerer> {
    static ANSWERER: OnceLock<Arc<dyn Answerer>> = OnceLock::new();
    ANSWERER
        .get_or_init(|| match RemoteAnswerer::from_env() {
            Some(a) => {
                tracing::info!("RAG answerer: hosted LLM (DOCHUB_AI_PROVIDER)");
                Arc::new(a)
            }
            None => {
                tracing::info!(
                    "RAG answerer: offline extractive (set DOCHUB_AI_PROVIDER for a hosted/local LLM)"
                );
                Arc::new(ExtractiveAnswerer::default())
            }
        })
        .clone()
}
