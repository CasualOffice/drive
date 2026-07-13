//! `POST /api/agent/ask` — agentic research over the workspace's documents.
//!
//! The "not generic MCP" path (CLAUDE.md AI layer): instead of a single
//! retrieve-then-answer, a [`dochub_ai::Agent`] drives a bounded ReAct loop —
//! the configured LLM issues its own searches, reads the passages, refines and
//! searches again if needed, then commits a cited answer. The agent's only door
//! to the corpus is a [`Retriever`] backed by [`retrieve_chunks`], so every
//! search it runs is **workspace-scoped and permission-filtered** exactly like a
//! direct user request — an agent can only reach what its user can view.
//!
//! Requires a configured hosted/local LLM ([`crate::ai::chat_model`]); on an
//! offline install the endpoint responds with `available: false` rather than a
//! degraded answer.

use axum::{extract::State, http::StatusCode, Json};
use dochub_ai::{Agent, AnswerContext, Retriever};
use dochub_auth::AuthSession;
use dochub_db::FileRepo;
use serde::{Deserialize, Serialize};

use crate::content_search::{kind_of, ws_status};
use crate::semantic_search::retrieve_chunks;
use crate::workspaces::resolve_active_workspace;
use crate::HttpState;

#[derive(Deserialize)]
pub(crate) struct AgentAskBody {
    /// The question.
    pub q: String,
    /// Optional explicit workspace; must be one the caller belongs to.
    pub workspace: Option<String>,
}

/// A source the agent's answer drew from.
#[derive(Serialize)]
pub(crate) struct AgentCitation {
    pub file_id: String,
    pub title: String,
    pub kind: String,
    /// The cited passage's text.
    pub snippet: String,
}

#[derive(Serialize)]
pub(crate) struct AgentAskResponse {
    /// False when no LLM is configured; the SPA shows a "configure AI" hint and
    /// `answer` is empty.
    pub available: bool,
    /// The agent's final answer. Empty when unavailable or nothing was found.
    pub answer: String,
    /// Sources supporting the answer, in first-use order.
    pub citations: Vec<AgentCitation>,
    /// The queries the agent issued — a transparent trace of its reasoning.
    pub searches: Vec<String>,
}

impl AgentAskResponse {
    fn empty(available: bool) -> Self {
        Self {
            available,
            answer: String::new(),
            citations: Vec::new(),
            searches: Vec::new(),
        }
    }
}

/// A [`Retriever`] over [`retrieve_chunks`] — enforces workspace + ACL, so the
/// agent never sees anything the user can't view. Shared by this endpoint and
/// the MCP `research` tool so both scope retrieval identically.
pub(crate) struct ChunkRetriever {
    state: HttpState,
    user_id: String,
    workspace: String,
}

impl ChunkRetriever {
    pub(crate) fn new(state: HttpState, user_id: String, workspace: String) -> Self {
        Self {
            state,
            user_id,
            workspace,
        }
    }
}

#[async_trait::async_trait]
impl Retriever for ChunkRetriever {
    async fn retrieve(
        &self,
        query: &str,
        k: usize,
    ) -> Result<Vec<AnswerContext>, dochub_ai::AiError> {
        let chunks = retrieve_chunks(&self.state, &self.user_id, &self.workspace, query, k)
            .await
            .map_err(|code| dochub_ai::AiError::Provider(format!("retrieval failed ({code})")))?;
        Ok(chunks
            .into_iter()
            .map(|(chunk, file, _)| AnswerContext {
                source_id: chunk.file_id,
                title: file.name,
                text: chunk.chunk_text,
            })
            .collect())
    }
}

/// `POST /api/agent/ask` — session-authed, workspace-scoped agentic research.
pub(crate) async fn agent_ask(
    State(s): State<HttpState>,
    session: AuthSession,
    Json(body): Json<AgentAskBody>,
) -> Result<Json<AgentAskResponse>, StatusCode> {
    let query = body.q.trim().to_string();

    let workspace = resolve_active_workspace(&s.db, &session.user_id, body.workspace.as_deref())
        .await
        .map_err(ws_status)?;

    // No LLM configured ⇒ the agent can't reason; say so explicitly.
    let Some(chat) = crate::ai::chat_model() else {
        return Ok(Json(AgentAskResponse::empty(false)));
    };
    if query.is_empty() {
        return Ok(Json(AgentAskResponse::empty(true)));
    }

    let retriever = ChunkRetriever {
        state: s.clone(),
        user_id: session.user_id.clone(),
        workspace,
    };

    let outcome = Agent::new(chat.as_ref(), &retriever)
        .run(&query)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "agent: research loop failed");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // Resolve each citation's pool context to a displayable source. `kind`
    // needs the File row, so re-fetch it (best-effort; a citation whose file
    // vanished mid-run is simply dropped).
    let files = FileRepo::new(&s.db);
    let mut citations = Vec::with_capacity(outcome.citations.len());
    for c in &outcome.citations {
        let Some(ctx) = outcome.contexts.get(c.context_index) else {
            continue;
        };
        let kind = match files.find_by_id(&ctx.source_id).await {
            Ok(file) => kind_of(&file),
            Err(_) => "document".to_string(),
        };
        citations.push(AgentCitation {
            file_id: ctx.source_id.clone(),
            title: ctx.title.clone(),
            kind,
            snippet: ctx.text.clone(),
        });
    }

    Ok(Json(AgentAskResponse {
        available: true,
        answer: outcome.answer,
        citations,
        searches: outcome.searches,
    }))
}
