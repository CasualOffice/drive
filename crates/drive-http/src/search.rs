//! `GET /api/search?q=&limit=&workspace=` — workspace-scoped name search.
//! Spec: docs/ux/12-search-surface.md. Workspace defaults to the caller's
//! Personal when omitted; an explicit `workspace=` switches to a team scope
//! when the caller is a member.

use axum::{
    extract::{Query, State},
    Json,
};
use drive_auth::AuthSession;
use drive_db::{FileRepo, FolderRepo};
use serde::{Deserialize, Serialize};

use crate::HttpState;

#[derive(Deserialize)]
pub(crate) struct SearchQuery {
    pub q: Option<String>,
    pub limit: Option<i64>,
    #[serde(default)]
    pub workspace: Option<String>,
}

#[derive(Serialize)]
pub(crate) struct FolderDto {
    id: String,
    parent_id: Option<String>,
    name: String,
    created_at: String,
    modified_at: String,
}

#[derive(Serialize)]
pub(crate) struct FileDto {
    id: String,
    parent_id: Option<String>,
    name: String,
    size: u64,
    content_type: Option<String>,
    version: u32,
    created_at: String,
    modified_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    thumbnail: Option<String>,
}

#[derive(Serialize)]
pub(crate) struct SearchResp {
    pub folders: Vec<FolderDto>,
    pub files: Vec<FileDto>,
}

pub(crate) async fn search(
    State(s): State<HttpState>,
    session: AuthSession,
    Query(q): Query<SearchQuery>,
) -> Result<Json<SearchResp>, axum::http::StatusCode> {
    let trimmed = q.q.as_deref().map_or("", str::trim);
    if trimmed.is_empty() {
        return Ok(Json(SearchResp {
            folders: vec![],
            files: vec![],
        }));
    }
    let limit = q.limit.unwrap_or(50).clamp(1, 200);

    let ws = crate::workspaces::resolve_active_workspace(
        &s.db,
        &session.user_id,
        q.workspace.as_deref(),
    )
    .await
    .map_err(|e| {
        tracing::error!(error = ?e, "search workspace resolve failed");
        axum::http::StatusCode::FORBIDDEN
    })?;

    let folders = FolderRepo::new(&s.db)
        .search(&ws, trimmed, limit)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "folder search failed");
            axum::http::StatusCode::INTERNAL_SERVER_ERROR
        })?
        .into_iter()
        .map(|f| FolderDto {
            id: f.id,
            parent_id: f.parent_id,
            name: f.name,
            created_at: rfc3339(f.created_at),
            modified_at: rfc3339(f.modified_at),
        })
        .collect();

    let files = FileRepo::new(&s.db)
        .search(&ws, trimmed, limit)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "file search failed");
            axum::http::StatusCode::INTERNAL_SERVER_ERROR
        })?
        .into_iter()
        .map(|f| FileDto {
            id: f.id,
            parent_id: f.parent_id,
            name: f.name,
            size: f.size,
            content_type: f.content_type,
            version: f.version,
            created_at: rfc3339(f.created_at),
            modified_at: rfc3339(f.modified_at),
            thumbnail: f.thumbnail,
        })
        .collect();

    Ok(Json(SearchResp { folders, files }))
}

fn rfc3339(t: time::OffsetDateTime) -> String {
    t.format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}
