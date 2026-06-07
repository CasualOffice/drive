//! `GET /api/admin/system` — admin-only system snapshot.
//! Spec: docs/ux/11-admin-surface.md.

use axum::{extract::State, http::StatusCode, response::IntoResponse, Json};
use drive_auth::AuthSession;
use drive_db::{AuditRepo, SessionRepo};
use serde::Serialize;

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
const GIT_SHA: &str = env!("DRIVE_GIT_SHA");
const BUILT_AT: &str = env!("DRIVE_BUILT_AT");
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
}

impl IntoResponse for AdminError {
    fn into_response(self) -> axum::response::Response {
        match self {
            Self::Forbidden => (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({"error": "admin access required"})),
            )
                .into_response(),
        }
    }
}
