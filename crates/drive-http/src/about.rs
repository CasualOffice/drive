//! `GET /api/about` — version, build, and runtime backend identity.
//!
//! Cheap, dependency-free, fully static. Surfaced under Settings → About.

use axum::{extract::State, Json};
use drive_auth::AuthSession;
use serde::Serialize;

use crate::state::HttpState;

const VERSION: &str = env!("CARGO_PKG_VERSION");
const GIT_SHA: &str = env!("DRIVE_GIT_SHA");
const BUILT_AT: &str = env!("DRIVE_BUILT_AT");
const LICENSE: &str = env!("CARGO_PKG_LICENSE");
const REPO: &str = env!("CARGO_PKG_REPOSITORY");

#[derive(Serialize)]
pub(crate) struct About {
    pub version: &'static str,
    pub git_sha: &'static str,
    pub built_at: &'static str,
    pub license: &'static str,
    pub repository: &'static str,
    pub storage_backend: String,
    pub db_backend: String,
}

/// Requires an authenticated session — the about pane lives behind sign-in.
pub(crate) async fn about(State(s): State<HttpState>, _session: AuthSession) -> Json<About> {
    Json(About {
        version: VERSION,
        git_sha: GIT_SHA,
        built_at: BUILT_AT,
        license: LICENSE,
        repository: REPO,
        storage_backend: format!("{:?}", s.config.backend),
        db_backend: format!("{:?}", s.db.backend()),
    })
}
