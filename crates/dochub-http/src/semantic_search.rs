//! `GET /api/search/semantic` — Phase 5 RAG retrieval.
//!
//! Distinct from [`crate::content_search`] (lexical BM25 over Tantivy): this
//! endpoint embeds the query with the same embedder the `embed_file` job used,
//! then ranks a workspace's stored chunk vectors (migration 0026) by cosine
//! similarity (`dochub_ai::top_k`). It answers "which passage *means* this?"
//! rather than "which document contains these words".
//!
//! Results are permission-filtered exactly like content search: the candidate
//! vectors are workspace-scoped, and every hit is re-checked against the
//! caller's `readable_scope` + workspace + trash state so a chunk the caller may
//! not view never leaks. Hits are deduped to the single best-scoring chunk per
//! file, and the chunk text is returned as the snippet (and as RAG context for a
//! future answer-composition step).

use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use dochub_ai::{top_k, Embedder, LocalEmbedder};
use dochub_auth::AuthSession;
use dochub_db::{EmbeddingRepo, FileRepo, StoredEmbedding};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use time::format_description::well_known::Rfc3339;

use crate::content_search::{kind_of, ws_status};
use crate::workspaces::resolve_active_workspace;
use crate::HttpState;

/// Minimum cosine similarity for a chunk to be returned. The offline
/// `LocalEmbedder` scores unrelated text near zero (and slightly negative), so a
/// small positive floor drops noise while keeping genuine lexical/semantic
/// overlap.
const MIN_SCORE: f32 = 0.05;

#[derive(Deserialize)]
pub(crate) struct SemanticQuery {
    pub q: Option<String>,
    pub limit: Option<usize>,
    /// Optional explicit workspace; must be one the caller belongs to.
    pub workspace: Option<String>,
}

#[derive(Serialize)]
pub(crate) struct SemanticHit {
    pub file_id: String,
    pub title: String,
    /// Coarse content kind (markdown/document/…), derived from the extension.
    pub kind: String,
    /// The matched chunk's text — the retrieval snippet / RAG context.
    pub snippet: String,
    /// 0-based chunk position within the file.
    pub chunk_index: i64,
    pub score: f32,
    pub modified_at: String,
}

/// `GET /api/search/semantic?q=&limit=&workspace=` — session-authed,
/// workspace-scoped, permission-filtered semantic hits.
pub(crate) async fn semantic_search(
    State(s): State<HttpState>,
    session: AuthSession,
    Query(q): Query<SemanticQuery>,
) -> Result<Json<Vec<SemanticHit>>, StatusCode> {
    let query = q.q.as_deref().map_or("", str::trim).to_string();
    let limit = q.limit.unwrap_or(10).clamp(1, 25);

    let workspace = resolve_active_workspace(&s.db, &session.user_id, q.workspace.as_deref())
        .await
        .map_err(ws_status)?;

    if query.is_empty() {
        return Ok(Json(vec![]));
    }

    // Embed the query with the same embedder the embed_file job used, so the
    // query vector lives in the same space as the stored chunk vectors.
    let embedder = LocalEmbedder::default();
    let query_vec = embedder.embed_one(&query).await.map_err(|e| {
        tracing::error!(error = %e, "semantic search: query embed failed");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Candidate set: every chunk vector in the workspace. Brute-force cosine —
    // fine at per-workspace scale (an ANN index is the scale follow-up).
    let stored = EmbeddingRepo::new(&s.db)
        .list_for_workspace(&workspace)
        .await
        .map_err(internal)?;
    if stored.is_empty() {
        return Ok(Json(vec![]));
    }

    let candidates: Vec<(StoredEmbedding, Vec<f32>)> = stored
        .into_iter()
        .map(|e| {
            let v = e.vector.clone();
            (e, v)
        })
        .collect();
    // Rank everything; dedup + permission filtering below trims to `limit`.
    let ranked = top_k(&query_vec, &candidates, candidates.len(), MIN_SCORE);

    // Permission filter + enrich, deduped to the best chunk per file.
    let scope = dochub_authz::readable_scope(&s.db, &session.user_id)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let files = FileRepo::new(&s.db);
    let mut seen: HashSet<String> = HashSet::new();
    let mut out: Vec<SemanticHit> = Vec::with_capacity(limit);
    for scored in ranked {
        if out.len() >= limit {
            break;
        }
        let chunk = scored.item;
        // Ranked is score-descending, so the first chunk seen for a file is its
        // best; skip later (lower-scoring) chunks from the same file.
        if !seen.insert(chunk.file_id.clone()) {
            continue;
        }
        let Ok(file) = files.find_by_id(&chunk.file_id).await else {
            continue;
        };
        if file.workspace_id.as_deref() != Some(workspace.as_str())
            || file.trashed_at.is_some()
            || !scope.can_view_file(&file)
        {
            continue;
        }
        out.push(SemanticHit {
            file_id: chunk.file_id,
            title: file.name.clone(),
            kind: kind_of(&file),
            snippet: chunk.chunk_text,
            chunk_index: chunk.chunk_index,
            score: scored.score,
            modified_at: file.modified_at.format(&Rfc3339).unwrap_or_default(),
        });
    }
    Ok(Json(out))
}

fn internal(e: dochub_db::DbError) -> StatusCode {
    tracing::error!(error = %e, "semantic search db error");
    StatusCode::INTERNAL_SERVER_ERROR
}
