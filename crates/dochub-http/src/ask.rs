//! `POST /api/search/ask` — RAG question answering (Phase 5 capstone).
//!
//! Retrieves the passages most relevant to the question (the same
//! permission-filtered semantic retrieval the `/api/search/semantic` endpoint
//! uses), hands them to a pluggable [`dochub_ai::Answerer`], and returns the
//! composed answer with citations back to the source documents.
//!
//! The default answerer is the offline, purely-extractive
//! [`dochub_ai::ExtractiveAnswerer`] — it invents nothing and needs no network,
//! so the whole RAG loop is self-hostable and testable. A hosted abstractive
//! model (e.g. Claude) slots in behind the same trait.

use axum::{extract::State, http::StatusCode, Json};
use dochub_ai::{AnswerContext, Answerer, ExtractiveAnswerer};
use dochub_auth::AuthSession;
use serde::{Deserialize, Serialize};

use crate::content_search::{kind_of, ws_status};
use crate::semantic_search::retrieve_chunks;
use crate::workspaces::resolve_active_workspace;
use crate::HttpState;

/// Chunks fed to the answerer as context. A handful is plenty for an extractive
/// answer and bounds the work; the retrieval is score-ranked so these are the
/// most relevant.
const MAX_CONTEXTS: usize = 6;

#[derive(Deserialize)]
pub(crate) struct AskBody {
    /// The question.
    pub q: String,
    /// Optional explicit workspace; must be one the caller belongs to.
    pub workspace: Option<String>,
}

/// A source the answer drew from.
#[derive(Serialize)]
pub(crate) struct AskCitation {
    pub file_id: String,
    pub title: String,
    pub kind: String,
    /// The cited chunk's text.
    pub snippet: String,
    pub score: f32,
}

#[derive(Serialize)]
pub(crate) struct AskResponse {
    /// The composed answer. Empty when nothing in the workspace addresses the
    /// question (the SPA shows a "no answer found" state).
    pub answer: String,
    /// Sources supporting the answer, in order of first use.
    pub citations: Vec<AskCitation>,
}

/// `POST /api/search/ask` — session-authed, workspace-scoped,
/// permission-filtered RAG answer with citations.
pub(crate) async fn ask(
    State(s): State<HttpState>,
    session: AuthSession,
    Json(body): Json<AskBody>,
) -> Result<Json<AskResponse>, StatusCode> {
    let query = body.q.trim().to_string();

    let workspace = resolve_active_workspace(&s.db, &session.user_id, body.workspace.as_deref())
        .await
        .map_err(ws_status)?;

    let empty = || {
        Ok(Json(AskResponse {
            answer: String::new(),
            citations: Vec::new(),
        }))
    };
    if query.is_empty() {
        return empty();
    }

    // Retrieve the most relevant permission-filtered chunks as context.
    let chunks = retrieve_chunks(&s, &session.user_id, &workspace, &query, MAX_CONTEXTS).await?;
    if chunks.is_empty() {
        return empty();
    }

    // The context slice is 1:1 with `chunks`, so a citation's context_index
    // indexes straight back into it.
    let contexts: Vec<AnswerContext> = chunks
        .iter()
        .map(|(chunk, file, _)| AnswerContext {
            source_id: chunk.file_id.clone(),
            title: file.name.clone(),
            text: chunk.chunk_text.clone(),
        })
        .collect();

    let answer = ExtractiveAnswerer::default()
        .answer(&query, &contexts)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "ask: answer composition failed");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let citations: Vec<AskCitation> = answer
        .citations
        .iter()
        .filter_map(|c| chunks.get(c.context_index))
        .map(|(chunk, file, score)| AskCitation {
            file_id: chunk.file_id.clone(),
            title: file.name.clone(),
            kind: kind_of(file),
            snippet: chunk.chunk_text.clone(),
            score: *score,
        })
        .collect();

    Ok(Json(AskResponse {
        answer: answer.text,
        citations,
    }))
}
