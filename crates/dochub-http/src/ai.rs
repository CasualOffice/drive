//! AI provider selection for the RAG + agentic endpoints.
//!
//! The hosted LLM is resolved from the environment once and cached. Provider-
//! agnostic: set `DOCHUB_AI_PROVIDER` to `anthropic` (Claude), `openai`
//! (ChatGPT), or `local` (a self-hosted OpenAI-compatible server) — see
//! [`dochub_ai::RemoteAnswerer::from_env`].
//!
//! Two capabilities are derived from the one cached client:
//! - [`answerer`] — single-shot RAG. Falls back to the offline
//!   [`dochub_ai::ExtractiveAnswerer`] when no provider is configured, so the
//!   `ask` endpoint stays self-hostable and every test is deterministic (no test
//!   sets the vars).
//! - [`chat_model`] — the multi-turn chat the agentic loop drives. Returns
//!   `None` when no provider is configured: the agent needs a real model to
//!   reason, so its endpoint degrades explicitly rather than pretending.

use std::sync::{Arc, OnceLock};

use dochub_ai::{Answerer, ChatModel, ExtractiveAnswerer, RemoteAnswerer};

/// The hosted LLM client, resolved once from the environment. `None` on an
/// offline install (no `DOCHUB_AI_PROVIDER`). Shared by both capabilities below
/// so they always use the same configured model.
fn remote() -> Option<Arc<RemoteAnswerer>> {
    static REMOTE: OnceLock<Option<Arc<RemoteAnswerer>>> = OnceLock::new();
    REMOTE
        .get_or_init(|| match RemoteAnswerer::from_env() {
            Some(a) => {
                tracing::info!("AI: hosted LLM configured (DOCHUB_AI_PROVIDER)");
                Some(Arc::new(a))
            }
            None => {
                tracing::info!(
                    "AI: no hosted LLM (set DOCHUB_AI_PROVIDER for RAG generation + the agent); \
                     ask falls back to offline extractive"
                );
                None
            }
        })
        .clone()
}

/// The configured RAG answerer. Hosted LLM when configured, else the offline
/// extractive baseline. Shared by the `ask` endpoint and the MCP `ask` tool so
/// they answer identically.
pub(crate) fn answerer() -> Arc<dyn Answerer> {
    match remote() {
        Some(a) => {
            let a: Arc<dyn Answerer> = a;
            a
        }
        None => {
            let a: Arc<dyn Answerer> = Arc::new(ExtractiveAnswerer::default());
            a
        }
    }
}

/// The chat model driving the agentic loop, or `None` when no hosted/local LLM
/// is configured (the agent requires a real model — there is no offline
/// substitute for multi-step reasoning).
pub(crate) fn chat_model() -> Option<Arc<dyn ChatModel>> {
    remote().map(|a| {
        let m: Arc<dyn ChatModel> = a;
        m
    })
}
