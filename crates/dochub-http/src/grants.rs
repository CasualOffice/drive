//! ACL grants — per-user (and per-role) sharing on files, folders, projects,
//! and workspaces. Spec: docs/design/foundation-access-rag-mcp.md §3 (F2a).
//!
//! Endpoints (all `authz::gate`-gated + audited):
//!   - `GET    /api/files/{id}/grants`  — list grants on a file
//!   - `POST   /api/files/{id}/grants`  — create a per-user grant (`share`)
//!   - `DELETE /api/grants/{grantId}`   — revoke a grant (`share`)
//!
//! Grants are stored via F1's [`AclRepo`] and resolved by [`dochub_authz`] when
//! it walks a resource's ancestor chain — so a grant on one file lets a
//! non-member `view` exactly that file and nothing else (deny-by-default).

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{delete, get},
    Json, Router,
};
use dochub_auth::AuthSession;
use dochub_authz::{effective_perms, role_permissions, Permission, ResourceRef, Role};
use dochub_db::{
    resource_kind, subject_kind, AclGrant, AclRepo, AuditRepo, FileRepo, NewAclGrant,
    NewAuditEvent, UserRepo,
};
use serde::{Deserialize, Serialize};

use crate::authz::gate;
use crate::HttpState;

// ── Errors ──────────────────────────────────────────────────────────────

#[derive(Debug, thiserror::Error)]
pub(crate) enum GrantError {
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

impl From<dochub_authz::AuthzError> for GrantError {
    fn from(e: dochub_authz::AuthzError) -> Self {
        match e {
            dochub_authz::AuthzError::Forbidden => Self::Forbidden,
            dochub_authz::AuthzError::Db(err) => Self::Internal(err.to_string()),
        }
    }
}

impl IntoResponse for GrantError {
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
                tracing::error!(error = %m, "grants handler error");
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

// ── DTOs ────────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct GrantDto {
    id: String,
    resource_kind: String,
    resource_id: String,
    subject_kind: String,
    subject_id: String,
    /// Resolved username for `subject_kind = "user"` grants (best-effort;
    /// `None` if the account was since removed). Lets the SPA render a chip
    /// without a second round trip.
    #[serde(skip_serializing_if = "Option::is_none")]
    subject_username: Option<String>,
    role: String,
    created_at: String,
    created_by: String,
}

async fn grant_to_dto(s: &HttpState, g: AclGrant) -> GrantDto {
    let subject_username = if g.subject_kind == subject_kind::USER {
        UserRepo::new(&s.db)
            .find_by_id(&g.subject_id)
            .await
            .ok()
            .map(|u| u.username)
    } else {
        None
    };
    GrantDto {
        id: g.id,
        resource_kind: g.resource_kind,
        resource_id: g.resource_id,
        subject_kind: g.subject_kind,
        subject_id: g.subject_id,
        subject_username,
        role: g.role,
        created_at: rfc3339(g.created_at),
        created_by: g.created_by,
    }
}

#[derive(Serialize)]
struct ListResp {
    grants: Vec<GrantDto>,
}

// ── Handlers ────────────────────────────────────────────────────────────

/// `GET /api/files/{id}/grants` — who has an explicit grant on this file.
/// Gated by `share` (whoever can share a file can see its sharing).
async fn list_file_grants(
    State(s): State<HttpState>,
    session: AuthSession,
    Path(file_id): Path<String>,
) -> Result<Json<ListResp>, GrantError> {
    let file = FileRepo::new(&s.db)
        .find_by_id(&file_id)
        .await
        .map_err(|_| GrantError::NotFound)?;
    gate(
        &s,
        &session,
        ResourceRef::File(file.id.clone()),
        Permission::Share,
    )
    .await?;

    let rows = AclRepo::new(&s.db)
        .list_for_resource(resource_kind::FILE, &file.id)
        .await
        .map_err(|e| GrantError::Internal(e.to_string()))?;
    let mut grants = Vec::with_capacity(rows.len());
    for g in rows {
        grants.push(grant_to_dto(&s, g).await);
    }
    Ok(Json(ListResp { grants }))
}

#[derive(Deserialize)]
struct CreateGrantBody {
    /// A user id or username — the sharee.
    user: String,
    /// `viewer` | `editor` | `admin` (not `owner` — ownership isn't shareable).
    role: String,
}

/// `POST /api/files/{id}/grants` — grant a role on this file to one user.
/// Gated by `share`; audited `acl.grant`.
async fn create_file_grant(
    State(s): State<HttpState>,
    session: AuthSession,
    Path(file_id): Path<String>,
    Json(body): Json<CreateGrantBody>,
) -> Result<(StatusCode, Json<GrantDto>), GrantError> {
    let file = FileRepo::new(&s.db)
        .find_by_id(&file_id)
        .await
        .map_err(|_| GrantError::NotFound)?;
    gate(
        &s,
        &session,
        ResourceRef::File(file.id.clone()),
        Permission::Share,
    )
    .await?;

    let role = parse_grantable_role(&body.role)?;

    // Ceiling: you cannot grant access you don't hold yourself. `share` alone
    // (which an Editor has) gates *reaching* this endpoint, but the granted
    // role's permissions must be a subset of the granter's own effective
    // permissions on this file — otherwise an Editor could mint an `admin`
    // grant and escalate a sharee above themselves (audit finding). Owners /
    // superadmins hold every permission, so they pass trivially.
    let granter_perms =
        effective_perms(&s.db, &session.user_id, &ResourceRef::File(file.id.clone())).await?;
    if !granter_perms.is_superset(role_permissions(role)) {
        return Err(GrantError::Forbidden);
    }

    // Resolve the sharee by id first, then username. 422 keeps this distinct
    // from a missing file (404).
    let users = UserRepo::new(&s.db);
    let target = match users.find_by_id(body.user.trim()).await {
        Ok(u) => u,
        Err(_) => users
            .find_by_username(body.user.trim())
            .await
            .map_err(|_| GrantError::Validation("no such user".into()))?,
    };

    let grant = AclRepo::new(&s.db)
        .grant(&NewAclGrant {
            resource_kind: resource_kind::FILE.into(),
            resource_id: file.id.clone(),
            subject_kind: subject_kind::USER.into(),
            subject_id: target.id.clone(),
            role: role.as_str().into(),
            created_by: session.user_id.clone(),
        })
        .await
        .map_err(|e| GrantError::Internal(e.to_string()))?;

    AuditRepo::emit(
        &s.db,
        NewAuditEvent {
            actor_id: Some(session.user_id.clone()),
            actor_username: Some(session.username.clone()),
            action: "acl.grant".into(),
            target_kind: Some("file".into()),
            target_id: Some(file.id.clone()),
            target_name: Some(file.name.clone()),
            ip_address: None,
            metadata: Some(format!(
                r#"{{"grant_id":"{}","subject_id":"{}","role":"{}"}}"#,
                grant.id,
                target.id,
                role.as_str()
            )),
        },
    );

    Ok((StatusCode::CREATED, Json(grant_to_dto(&s, grant).await)))
}

/// `DELETE /api/grants/{grantId}` — revoke a grant. Gated by `share` on the
/// grant's own resource; audited `acl.revoke`.
async fn revoke_grant(
    State(s): State<HttpState>,
    session: AuthSession,
    Path(grant_id): Path<String>,
) -> Result<StatusCode, GrantError> {
    let repo = AclRepo::new(&s.db);
    let grant = repo
        .find_by_id(&grant_id)
        .await
        .map_err(|_| GrantError::NotFound)?;

    let resource = resource_ref(&grant.resource_kind, grant.resource_id.clone())
        .ok_or(GrantError::NotFound)?;
    gate(&s, &session, resource, Permission::Share).await?;

    repo.revoke(&grant_id)
        .await
        .map_err(|e| GrantError::Internal(e.to_string()))?;

    AuditRepo::emit(
        &s.db,
        NewAuditEvent {
            actor_id: Some(session.user_id.clone()),
            actor_username: Some(session.username.clone()),
            action: "acl.revoke".into(),
            target_kind: Some(grant.resource_kind.clone()),
            target_id: Some(grant.resource_id.clone()),
            target_name: None,
            ip_address: None,
            metadata: Some(format!(
                r#"{{"grant_id":"{}","subject_id":"{}"}}"#,
                grant.id, grant.subject_id
            )),
        },
    );
    Ok(StatusCode::NO_CONTENT)
}

// ── Helpers ─────────────────────────────────────────────────────────────

/// Parse a grantable role. `owner` is rejected — ownership is not shareable
/// through an ACL grant (transfer is a workspace-owner-only op).
fn parse_grantable_role(s: &str) -> Result<Role, GrantError> {
    match Role::from_db(s.trim()) {
        Some(Role::Owner) => Err(GrantError::Validation(
            "cannot grant the owner role via sharing".into(),
        )),
        Some(r) => Ok(r),
        None => Err(GrantError::Validation(
            "role must be one of: viewer, editor, admin".into(),
        )),
    }
}

/// Map a stored `acl_grants.resource_kind` to a [`ResourceRef`] for enforcement.
fn resource_ref(kind: &str, id: String) -> Option<ResourceRef> {
    match kind {
        resource_kind::WORKSPACE => Some(ResourceRef::Workspace(id)),
        resource_kind::PROJECT => Some(ResourceRef::Project(id)),
        resource_kind::FOLDER => Some(ResourceRef::Folder(id)),
        resource_kind::FILE => Some(ResourceRef::File(id)),
        _ => None,
    }
}

fn rfc3339(t: time::OffsetDateTime) -> String {
    t.format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

pub(crate) fn router(state: HttpState) -> Router {
    Router::new()
        .route(
            "/api/files/{id}/grants",
            get(list_file_grants).post(create_file_grant),
        )
        .route("/api/grants/{grant_id}", delete(revoke_grant))
        .with_state(state)
}
