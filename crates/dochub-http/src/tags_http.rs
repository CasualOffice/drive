//! Tags — workspace-scoped labels and file assignment. Builds on the
//! `dochub-db` tag data layer. Spec: search-by-tag.
//!
//!   - `GET    /api/workspaces/{id}/tags`            — list           (`View`)
//!   - `POST   /api/workspaces/{id}/tags`            — create         (`Edit`)
//!   - `DELETE /api/workspaces/{id}/tags/{tag_id}`   — delete         (`Delete`)
//!   - `GET    /api/files/{file_id}/tags`            — tags on a file (`View` on file)
//!   - `PUT    /api/files/{file_id}/tags/{tag_id}`   — assign         (`Edit` on file)
//!   - `DELETE /api/files/{file_id}/tags/{tag_id}`   — unassign       (`Edit` on file)
//!
//! Tag CRUD gates on the workspace; assignment gates on the file. A tag can
//! only be attached to a file in the same workspace.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, put},
    Json, Router,
};
use dochub_auth::AuthSession;
use dochub_authz::{Permission, ResourceRef};
use dochub_db::{AuditRepo, FileRepo, NewAuditEvent, NewTag, Tag, TagRepo};
use serde::{Deserialize, Serialize};

use crate::authz::gate;
use crate::HttpState;

#[derive(Debug, thiserror::Error)]
pub(crate) enum TagError {
    #[error("not found")]
    NotFound,
    #[error("forbidden")]
    Forbidden,
    #[error("validation: {0}")]
    Validation(String),
    #[error("internal: {0}")]
    Internal(String),
}

#[derive(Serialize)]
struct ErrBody<'a> {
    error: &'a str,
}

impl From<dochub_authz::AuthzError> for TagError {
    fn from(e: dochub_authz::AuthzError) -> Self {
        match e {
            dochub_authz::AuthzError::Forbidden => Self::Forbidden,
            dochub_authz::AuthzError::Db(err) => Self::Internal(err.to_string()),
        }
    }
}

impl IntoResponse for TagError {
    fn into_response(self) -> Response {
        match self {
            Self::NotFound => {
                (StatusCode::NOT_FOUND, Json(ErrBody { error: "not found" })).into_response()
            }
            Self::Forbidden => {
                (StatusCode::FORBIDDEN, Json(ErrBody { error: "forbidden" })).into_response()
            }
            Self::Validation(m) => {
                (StatusCode::BAD_REQUEST, Json(ErrBody { error: &m })).into_response()
            }
            Self::Internal(m) => {
                tracing::error!(error = %m, "tags handler error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrBody {
                        error: "internal error",
                    }),
                )
                    .into_response()
            }
        }
    }
}

fn internal(e: impl std::fmt::Display) -> TagError {
    TagError::Internal(e.to_string())
}

#[derive(Serialize)]
struct TagDto {
    id: String,
    workspace_id: String,
    name: String,
    color: Option<String>,
    created_at: String,
}

impl From<Tag> for TagDto {
    fn from(t: Tag) -> Self {
        Self {
            id: t.id,
            workspace_id: t.workspace_id,
            name: t.name,
            color: t.color,
            created_at: rfc3339(t.created_at),
        }
    }
}

#[derive(Serialize)]
struct ListResp {
    tags: Vec<TagDto>,
}

async fn list_workspace_tags(
    State(s): State<HttpState>,
    session: AuthSession,
    Path(workspace_id): Path<String>,
) -> Result<Json<ListResp>, TagError> {
    gate(
        &s,
        &session,
        ResourceRef::Workspace(workspace_id.clone()),
        Permission::View,
    )
    .await?;

    let tags = TagRepo::new(&s.db)
        .list_for_workspace(&workspace_id)
        .await
        .map_err(internal)?
        .into_iter()
        .map(TagDto::from)
        .collect();
    Ok(Json(ListResp { tags }))
}

#[derive(Deserialize)]
struct CreateBody {
    name: String,
    #[serde(default)]
    color: Option<String>,
}

async fn create_tag(
    State(s): State<HttpState>,
    session: AuthSession,
    Path(workspace_id): Path<String>,
    Json(body): Json<CreateBody>,
) -> Result<(StatusCode, Json<TagDto>), TagError> {
    gate(
        &s,
        &session,
        ResourceRef::Workspace(workspace_id.clone()),
        Permission::Edit,
    )
    .await?;

    let name = sanitise_name(&body.name)?;
    let color = sanitise_color(body.color)?;

    let tag = TagRepo::new(&s.db)
        .get_or_create(&NewTag {
            workspace_id: workspace_id.clone(),
            name,
            color,
            created_by: session.user_id.clone(),
        })
        .await
        .map_err(internal)?;

    AuditRepo::emit(
        &s.db,
        NewAuditEvent {
            actor_id: Some(session.user_id.clone()),
            actor_username: Some(session.username.clone()),
            action: "tag.create".into(),
            target_kind: Some("tag".into()),
            target_id: Some(tag.id.clone()),
            target_name: Some(tag.name.clone()),
            ip_address: None,
            metadata: Some(format!(r#"{{"workspace_id":"{workspace_id}"}}"#)),
        },
    );

    Ok((StatusCode::CREATED, Json(TagDto::from(tag))))
}

async fn delete_tag(
    State(s): State<HttpState>,
    session: AuthSession,
    Path((workspace_id, tag_id)): Path<(String, String)>,
) -> Result<StatusCode, TagError> {
    gate(
        &s,
        &session,
        ResourceRef::Workspace(workspace_id.clone()),
        Permission::Delete,
    )
    .await?;

    let repo = TagRepo::new(&s.db);
    let tag = repo
        .find_by_id(&tag_id)
        .await
        .map_err(internal)?
        .ok_or(TagError::NotFound)?;
    // The tag must belong to the workspace in the path (prevents cross-workspace
    // deletes via a guessed id).
    if tag.workspace_id != workspace_id {
        return Err(TagError::NotFound);
    }
    repo.delete(&tag_id).await.map_err(internal)?;

    AuditRepo::emit(
        &s.db,
        NewAuditEvent {
            actor_id: Some(session.user_id.clone()),
            actor_username: Some(session.username.clone()),
            action: "tag.delete".into(),
            target_kind: Some("tag".into()),
            target_id: Some(tag.id.clone()),
            target_name: Some(tag.name.clone()),
            ip_address: None,
            metadata: Some(format!(r#"{{"workspace_id":"{workspace_id}"}}"#)),
        },
    );
    Ok(StatusCode::NO_CONTENT)
}

async fn list_file_tags(
    State(s): State<HttpState>,
    session: AuthSession,
    Path(file_id): Path<String>,
) -> Result<Json<ListResp>, TagError> {
    gate(
        &s,
        &session,
        ResourceRef::File(file_id.clone()),
        Permission::View,
    )
    .await?;

    let tags = TagRepo::new(&s.db)
        .tags_for_file(&file_id)
        .await
        .map_err(internal)?
        .into_iter()
        .map(TagDto::from)
        .collect();
    Ok(Json(ListResp { tags }))
}

async fn assign_tag(
    State(s): State<HttpState>,
    session: AuthSession,
    Path((file_id, tag_id)): Path<(String, String)>,
) -> Result<StatusCode, TagError> {
    gate(
        &s,
        &session,
        ResourceRef::File(file_id.clone()),
        Permission::Edit,
    )
    .await?;

    ensure_same_workspace(&s, &file_id, &tag_id).await?;

    TagRepo::new(&s.db)
        .assign(&file_id, &tag_id, &session.user_id)
        .await
        .map_err(internal)?;

    AuditRepo::emit(
        &s.db,
        NewAuditEvent {
            actor_id: Some(session.user_id.clone()),
            actor_username: Some(session.username.clone()),
            action: "tag.assign".into(),
            target_kind: Some("file".into()),
            target_id: Some(file_id.clone()),
            target_name: None,
            ip_address: None,
            metadata: Some(format!(r#"{{"tag_id":"{tag_id}"}}"#)),
        },
    );
    Ok(StatusCode::NO_CONTENT)
}

async fn unassign_tag(
    State(s): State<HttpState>,
    session: AuthSession,
    Path((file_id, tag_id)): Path<(String, String)>,
) -> Result<StatusCode, TagError> {
    gate(
        &s,
        &session,
        ResourceRef::File(file_id.clone()),
        Permission::Edit,
    )
    .await?;

    TagRepo::new(&s.db)
        .unassign(&file_id, &tag_id)
        .await
        .map_err(internal)?;

    AuditRepo::emit(
        &s.db,
        NewAuditEvent {
            actor_id: Some(session.user_id.clone()),
            actor_username: Some(session.username.clone()),
            action: "tag.unassign".into(),
            target_kind: Some("file".into()),
            target_id: Some(file_id.clone()),
            target_name: None,
            ip_address: None,
            metadata: Some(format!(r#"{{"tag_id":"{tag_id}"}}"#)),
        },
    );
    Ok(StatusCode::NO_CONTENT)
}

/// A tag may only be attached to a file in the same workspace.
async fn ensure_same_workspace(s: &HttpState, file_id: &str, tag_id: &str) -> Result<(), TagError> {
    let file = FileRepo::new(&s.db)
        .find_by_id(file_id)
        .await
        .map_err(|_| TagError::NotFound)?;
    let file_ws = file.workspace_id.as_deref().ok_or(TagError::NotFound)?;
    let tag = TagRepo::new(&s.db)
        .find_by_id(tag_id)
        .await
        .map_err(internal)?
        .ok_or(TagError::NotFound)?;
    if tag.workspace_id != file_ws {
        return Err(TagError::Validation(
            "tag and file are in different workspaces".into(),
        ));
    }
    Ok(())
}

fn sanitise_name(s: &str) -> Result<String, TagError> {
    let t = s.trim();
    let n = t.chars().count();
    if !(1..=40).contains(&n) {
        return Err(TagError::Validation(
            "tag name must be 1–40 characters".into(),
        ));
    }
    Ok(t.to_string())
}

/// Optional color: a `#rgb` or `#rrggbb` hex string. Empty/absent → None.
fn sanitise_color(color: Option<String>) -> Result<Option<String>, TagError> {
    let Some(raw) = color else { return Ok(None) };
    let t = raw.trim();
    if t.is_empty() {
        return Ok(None);
    }
    let ok = (t.len() == 4 || t.len() == 7)
        && t.starts_with('#')
        && t[1..].chars().all(|c| c.is_ascii_hexdigit());
    if !ok {
        return Err(TagError::Validation(
            "color must be a #rgb or #rrggbb hex value".into(),
        ));
    }
    Ok(Some(t.to_string()))
}

fn rfc3339(t: time::OffsetDateTime) -> String {
    t.format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

pub(crate) fn router(state: HttpState) -> Router {
    Router::new()
        .route(
            "/api/workspaces/{workspace_id}/tags",
            get(list_workspace_tags).post(create_tag),
        )
        .route(
            "/api/workspaces/{workspace_id}/tags/{tag_id}",
            axum::routing::delete(delete_tag),
        )
        .route("/api/files/{file_id}/tags", get(list_file_tags))
        .route(
            "/api/files/{file_id}/tags/{tag_id}",
            put(assign_tag).delete(unassign_tag),
        )
        .with_state(state)
}
