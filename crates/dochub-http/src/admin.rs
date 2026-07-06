//! `GET /api/admin/system` — admin-only system snapshot.
//! Spec: docs/ux/11-admin-surface.md.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, patch, post},
    Json, Router,
};
use dochub_auth::{hash_password, AuthSession};
use dochub_db::{AuditRepo, NewAuditEvent, NewUser, SessionRepo, UserRepo};
use serde::{Deserialize, Serialize};

use crate::HttpState;

#[derive(Serialize)]
pub(crate) struct StorageConfig {
    pub fs_root: Option<String>,
    pub s3_bucket: Option<String>,
    pub s3_endpoint: Option<String>,
    pub s3_region: Option<String>,
}

#[derive(Serialize)]
pub(crate) struct RecentSignIn {
    pub actor_username: Option<String>,
    pub ok: bool,
    pub at: String,
}

#[derive(Serialize)]
pub(crate) struct AdminSystem {
    pub version: &'static str,
    pub git_sha: &'static str,
    pub built_at: &'static str,
    pub license: &'static str,
    pub storage_backend: String,
    pub storage_config: StorageConfig,
    pub db_backend: String,
    pub uptime_seconds: u64,
    pub active_sessions: i64,
    pub healthy: bool,
    pub recent_sign_ins: Vec<RecentSignIn>,
}

const VERSION: &str = env!("CARGO_PKG_VERSION");
const GIT_SHA: &str = env!("DOCHUB_GIT_SHA");
const BUILT_AT: &str = env!("DOCHUB_BUILT_AT");
const LICENSE: &str = env!("CARGO_PKG_LICENSE");

pub(crate) async fn system(
    State(s): State<HttpState>,
    session: AuthSession,
) -> Result<Json<AdminSystem>, AdminError> {
    if !session.is_admin {
        return Err(AdminError::Forbidden);
    }

    let active_sessions = SessionRepo::new(&s.db).count_active().await.unwrap_or(0);

    let events = AuditRepo::new(&s.db)
        .list_filtered(&["auth.sign_in", "auth.sign_in_failed"], 10)
        .await
        .unwrap_or_default();
    let recent_sign_ins = events
        .into_iter()
        .map(|e| RecentSignIn {
            actor_username: e.actor_username.or(e.target_name),
            ok: e.action == "auth.sign_in",
            at: e
                .created_at
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default(),
        })
        .collect();

    Ok(Json(AdminSystem {
        version: VERSION,
        git_sha: GIT_SHA,
        built_at: BUILT_AT,
        license: LICENSE,
        storage_backend: format!("{:?}", s.config.backend),
        storage_config: StorageConfig {
            fs_root: s.config.fs_root.clone(),
            s3_bucket: s.config.s3_bucket.clone(),
            s3_endpoint: s.config.s3_endpoint.clone(),
            s3_region: s.config.s3_region.clone(),
        },
        db_backend: format!("{:?}", s.db.backend()),
        uptime_seconds: s.uptime_seconds(),
        active_sessions,
        // v0 has no real liveness probes against storage/db beyond "the
        // process is responding to HTTP". When those land in Phase 2 this
        // flag tracks them.
        healthy: true,
        recent_sign_ins,
    }))
}

#[derive(Debug)]
pub(crate) enum AdminError {
    Forbidden,
    Validation(String),
    NotFound,
    Conflict(String),
    Internal(String),
}

impl IntoResponse for AdminError {
    fn into_response(self) -> axum::response::Response {
        match self {
            Self::Forbidden => (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({"error": "admin access required"})),
            )
                .into_response(),
            Self::Validation(m) => (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": m})),
            )
                .into_response(),
            Self::NotFound => (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "not found"})),
            )
                .into_response(),
            Self::Conflict(m) => {
                (StatusCode::CONFLICT, Json(serde_json::json!({"error": m}))).into_response()
            }
            Self::Internal(m) => {
                tracing::error!(error = %m, "admin handler internal");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": "internal error"})),
                )
                    .into_response()
            }
        }
    }
}

// ── User management ────────────────────────────────────────────────────

#[derive(Serialize)]
pub(crate) struct AdminUserDto {
    pub id: String,
    pub username: String,
    pub is_admin: bool,
    pub created_at: String,
    pub used_bytes: u64,
    pub quota_bytes: Option<u64>,
}

#[derive(Serialize)]
pub(crate) struct UsersResp {
    pub users: Vec<AdminUserDto>,
}

pub(crate) async fn list_users(
    State(s): State<HttpState>,
    session: AuthSession,
) -> Result<Json<UsersResp>, AdminError> {
    if !session.is_admin {
        return Err(AdminError::Forbidden);
    }
    let users = UserRepo::new(&s.db);
    let rows = users
        .list_all()
        .await
        .map_err(|e| AdminError::Internal(e.to_string()))?;
    let mut out = Vec::with_capacity(rows.len());
    for u in rows {
        let used = users.used_bytes(&u.id).await.unwrap_or(0);
        out.push(AdminUserDto {
            id: u.id,
            username: u.username,
            is_admin: u.is_admin,
            created_at: u
                .created_at
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default(),
            used_bytes: used,
            quota_bytes: u.quota_bytes,
        });
    }
    Ok(Json(UsersResp { users: out }))
}

#[derive(Deserialize)]
pub(crate) struct CreateUserBody {
    pub username: String,
    pub password: String,
    #[serde(default)]
    pub is_admin: bool,
    #[serde(default)]
    pub quota_bytes: Option<u64>,
}

pub(crate) async fn create_user(
    State(s): State<HttpState>,
    session: AuthSession,
    Json(body): Json<CreateUserBody>,
) -> Result<(StatusCode, Json<AdminUserDto>), AdminError> {
    if !session.is_admin {
        return Err(AdminError::Forbidden);
    }
    let username = body.username.trim();
    if username.len() < 3 {
        return Err(AdminError::Validation(
            "username must be at least 3 characters".into(),
        ));
    }
    if body.password.chars().count() < 12 {
        return Err(AdminError::Validation(
            "password must be at least 12 characters".into(),
        ));
    }
    let password_hash =
        hash_password(&body.password).map_err(|e| AdminError::Internal(e.to_string()))?;
    let users = UserRepo::new(&s.db);
    let u = users
        .insert(&NewUser {
            username: username.to_string(),
            password_hash,
            is_admin: body.is_admin,
        })
        .await
        .map_err(|e| match e {
            dochub_db::DbError::UniqueViolation(_) => {
                AdminError::Conflict("username already taken".into())
            }
            other => AdminError::Internal(other.to_string()),
        })?;
    if let Some(q) = body.quota_bytes {
        let _ = users.set_quota(&u.id, Some(q)).await;
    }
    AuditRepo::emit(
        &s.db,
        NewAuditEvent {
            actor_id: Some(session.user_id.clone()),
            actor_username: Some(session.username.clone()),
            action: "admin.user_created".into(),
            target_kind: Some("user".into()),
            target_id: Some(u.id.clone()),
            target_name: Some(u.username.clone()),
            ip_address: None,
            metadata: body
                .quota_bytes
                .map(|q| format!(r#"{{"quota_bytes":{q}}}"#)),
        },
    );

    Ok((
        StatusCode::CREATED,
        Json(AdminUserDto {
            id: u.id,
            username: u.username,
            is_admin: u.is_admin,
            created_at: u
                .created_at
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default(),
            used_bytes: 0,
            quota_bytes: body.quota_bytes,
        }),
    ))
}

#[derive(Deserialize)]
pub(crate) struct SetQuotaBody {
    /// `None` clears the cap (unlimited).
    pub quota_bytes: Option<u64>,
}

pub(crate) async fn set_user_quota(
    State(s): State<HttpState>,
    session: AuthSession,
    Path(user_id): Path<String>,
    Json(body): Json<SetQuotaBody>,
) -> Result<StatusCode, AdminError> {
    if !session.is_admin {
        return Err(AdminError::Forbidden);
    }
    let users = UserRepo::new(&s.db);
    let target = users
        .find_by_id(&user_id)
        .await
        .map_err(|_| AdminError::NotFound)?;
    users
        .set_quota(&user_id, body.quota_bytes)
        .await
        .map_err(|e| AdminError::Internal(e.to_string()))?;
    AuditRepo::emit(
        &s.db,
        NewAuditEvent {
            actor_id: Some(session.user_id.clone()),
            actor_username: Some(session.username.clone()),
            action: "admin.quota_set".into(),
            target_kind: Some("user".into()),
            target_id: Some(target.id),
            target_name: Some(target.username),
            ip_address: None,
            metadata: Some(match body.quota_bytes {
                Some(q) => format!(r#"{{"quota_bytes":{q}}}"#),
                None => r#"{"quota_bytes":null}"#.into(),
            }),
        },
    );
    Ok(StatusCode::NO_CONTENT)
}

// ── User-facing: request a quota upgrade ──────────────────────────────

#[derive(Deserialize)]
pub(crate) struct QuotaRequestBody {
    /// Bytes the user would like their cap raised to. Optional — when
    /// missing, the audit event just records that they want more.
    #[serde(default)]
    pub requested_bytes: Option<u64>,
    /// Free-form reason from the user. Capped at 280 chars (one tweet).
    #[serde(default)]
    pub reason: Option<String>,
}

pub(crate) async fn request_quota_upgrade(
    State(s): State<HttpState>,
    session: AuthSession,
    Json(body): Json<QuotaRequestBody>,
) -> Result<StatusCode, AdminError> {
    let reason = body
        .reason
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.chars().take(280).collect::<String>());
    let metadata = match (body.requested_bytes, reason.as_deref()) {
        (Some(b), Some(r)) => Some(format!(
            r#"{{"requested_bytes":{b},"reason":{}}}"#,
            serde_json::to_string(r).unwrap_or_else(|_| "\"\"".into())
        )),
        (Some(b), None) => Some(format!(r#"{{"requested_bytes":{b}}}"#)),
        (None, Some(r)) => Some(format!(
            r#"{{"reason":{}}}"#,
            serde_json::to_string(r).unwrap_or_else(|_| "\"\"".into())
        )),
        (None, None) => None,
    };
    AuditRepo::emit(
        &s.db,
        NewAuditEvent {
            actor_id: Some(session.user_id.clone()),
            actor_username: Some(session.username.clone()),
            action: "quota.upgrade_request".into(),
            target_kind: Some("user".into()),
            target_id: Some(session.user_id.clone()),
            target_name: Some(session.username.clone()),
            ip_address: None,
            metadata,
        },
    );
    Ok(StatusCode::NO_CONTENT)
}

pub(crate) fn admin_router(state: HttpState) -> Router {
    Router::new()
        .route("/api/admin/users", get(list_users).post(create_user))
        .route("/api/admin/users/{id}/quota", patch(set_user_quota))
        .route("/api/me/quota/request", post(request_quota_upgrade))
        .with_state(state)
}
