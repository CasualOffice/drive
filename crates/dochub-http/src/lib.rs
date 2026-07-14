//! HTTP layer for Casual Drive. Assembles the Axum router that serves both
//! the app origin (`drive.<host>`) and the user-content origin
//! (`usercontent-drive.<host>`) from one binary.
//!
//! See [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §"Two-origin
//! security model".

#![forbid(unsafe_code)]

mod about;
mod access_log;
mod activity;
mod admin;
mod agent_http;
mod ai;
mod ask;
mod authz;
mod collab;
mod compliance;
mod content_search;
mod diff;
mod direct_upload;
mod embedding;
mod error;
mod files;
mod grants;
pub mod headers;
mod host_dispatch;
mod invitations;
mod mcp_http;
mod members;
mod metrics;
mod notes;
mod oidc;
mod pii_http;
pub mod presence;
mod projects_http;
mod rate_limit;
mod raw;
mod search;
mod semantic_search;
mod share;
mod spa;
mod state;
mod summary_http;
mod tags_http;
mod tokens_http;
mod versions;
mod wopi_docs;
mod workspace_storage;
mod workspaces;

pub use access_log::access_log;
pub use content_search::{spawn_indexer, IndexFileHandler};
pub use embedding::EmbedFileHandler;
pub use rate_limit::{RateLimitConfig, RateLimiter};
pub use state::HttpState;

use axum::{
    extract::State,
    http::{HeaderValue, StatusCode},
    middleware,
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use dochub_auth::AuthSession;
use dochub_wopi::WopiAppState;
use tower_http::set_header::SetResponseHeaderLayer;

use crate::{
    headers::{
        APP_CSP, HSTS, H_CSP, H_HSTS, H_PP, H_REF, H_XCTO, PERMISSIONS_POLICY, REFERRER_POLICY,
        UCN_CSP,
    },
    host_dispatch::{host_dispatch, Origin},
};

/// Top-level Drive router. Assembles both origins.
pub fn router(state: HttpState) -> Router {
    Router::new()
        .merge(app_origin_router(state.clone()))
        .merge(usercontent_router(state))
}

/// Liveness probe — the process is up and serving. Unconditional and
/// dependency-free, so a transient DB blip never restarts a healthy process.
async fn healthz() -> impl IntoResponse {
    (StatusCode::OK, "ok\n")
}

#[derive(serde::Serialize)]
struct Readiness {
    ready: bool,
    /// Per-dependency status (`"ok"` / `"error"`).
    checks: std::collections::BTreeMap<&'static str, &'static str>,
    backend: String,
}

/// Readiness probe — the process can serve real traffic, i.e. its critical
/// dependency (the database) is reachable. `200` when ready, `503` otherwise, so
/// an orchestrator stops routing to an instance that can't reach its DB without
/// killing it (that's [`healthz`]'s job). Unauthenticated, like `healthz`.
async fn readyz(State(s): State<HttpState>) -> impl IntoResponse {
    // Both critical dependencies must be reachable to serve real traffic: the
    // metadata DB and the object store (a read-only probe — never writes).
    let db_ok = s.db.ping().await.is_ok();
    let storage_ok = s.storage.check().await.is_ok();
    let ready = db_ok && storage_ok;

    let mut checks = std::collections::BTreeMap::new();
    checks.insert("db", if db_ok { "ok" } else { "error" });
    checks.insert("storage", if storage_ok { "ok" } else { "error" });
    let status = if ready {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (
        status,
        axum::Json(Readiness {
            ready,
            checks,
            backend: format!("{:?}", s.config.backend),
        }),
    )
}

/// `GET /metrics` — Prometheus exposition of aggregate HTTP counters (by status
/// class), the in-flight gauge, and uptime. Unauthenticated on the app origin,
/// the Prometheus norm; only non-sensitive aggregates are exposed. Counters are
/// fed by the [`access_log`] middleware, so they reflect real served traffic.
async fn metrics_endpoint(State(s): State<HttpState>) -> impl IntoResponse {
    let body = metrics::render(s.uptime_seconds());
    (
        [(
            axum::http::header::CONTENT_TYPE,
            HeaderValue::from_static("text/plain; version=0.0.4"),
        )],
        body,
    )
}

#[derive(serde::Serialize)]
struct Me {
    admin: String,
    backend: String,
    user_id: String,
    is_admin: bool,
    /// Bytes the caller has stored, summed over their non-trashed files.
    used_bytes: u64,
    /// Per-user storage cap; `None` means unlimited.
    quota_bytes: Option<u64>,
}

/// `/api/me` requires an authenticated session — returns 401 for the SPA's
/// initial bootstrap when no cookie is present, so AuthContext falls back
/// to the SignIn page instead of going straight to the shell.
async fn api_me(State(s): State<HttpState>, session: AuthSession) -> axum::Json<Me> {
    let users = dochub_db::UserRepo::new(&s.db);
    let used_bytes = users.used_bytes(&session.user_id).await.unwrap_or(0);
    let quota_bytes = users
        .find_by_id(&session.user_id)
        .await
        .ok()
        .and_then(|u| u.quota_bytes);
    axum::Json(Me {
        admin: session.username.clone(),
        backend: format!("{:?}", s.config.backend),
        user_id: session.user_id,
        is_admin: session.is_admin,
        used_bytes,
        quota_bytes,
    })
}

fn app_origin_router(state: HttpState) -> Router {
    // WOPI GetFile/PutFile route through the encrypted version chain via the
    // registry-backed document store — never a plaintext blob.
    let wopi_deks =
        dochub_db::WorkspaceDeks::new(state.db.clone(), state.config.master_kek.clone());
    let wopi_registry =
        dochub_db::Registry::new(state.db.clone(), state.storage.clone(), wopi_deks);
    let wopi_docs: std::sync::Arc<dyn dochub_wopi::DocumentStore> =
        std::sync::Arc::new(wopi_docs::RegistryDocStore::new(wopi_registry));
    let wopi_state = WopiAppState {
        docs: wopi_docs,
        wopi: state.wopi.clone(),
        jwt_secret: state.jwt_secret.clone(),
    };
    let wopi_router: Router = dochub_wopi::router(wopi_state);
    let auth_router: Router = dochub_auth::router(state.auth.clone());
    let body_limit_bytes = (state.config.body_limit_mb as usize)
        .saturating_mul(1024)
        .saturating_mul(1024);
    let files_router: Router = files::router(state.clone(), body_limit_bytes);
    let collab_router: Router = collab::router(state.clone(), body_limit_bytes);
    let versions_router: Router = versions::router(state.clone());
    let share_router: Router = share::router(state.clone());
    let workspaces_router: Router = workspaces::router(state.clone());
    let workspace_storage_router: Router = workspace_storage::router(state.clone());
    let oidc_router: Router = oidc::router(state.clone());
    let direct_upload_router: Router = direct_upload::router(state.clone());
    let notes_router: Router = notes::router(state.clone());
    let admin_users_router: Router = admin::admin_router(state.clone());
    let compliance_router: Router = compliance::router(state.clone());
    let presence_router: Router = presence::router().with_state(state.clone());
    let invitations_router: Router = invitations::router(state.clone());
    let grants_router: Router = grants::router(state.clone());
    let members_router: Router = members::router(state.clone());
    let projects_router: Router = projects_http::router(state.clone());
    let tags_router: Router = tags_http::router(state.clone());
    let tokens_router: Router = tokens_http::router(state.clone());

    Router::new()
        .route("/healthz", get(healthz))
        .route("/readyz", get(readyz))
        .route("/metrics", get(metrics_endpoint))
        .route("/api/me", get(api_me))
        .route("/api/about", get(about::about))
        .route("/api/activity", get(activity::list_activity))
        .route("/api/admin/system", get(admin::system))
        .route("/api/search", get(search::search))
        .route("/api/search/content", get(content_search::content_search))
        .route(
            "/api/search/semantic",
            get(semantic_search::semantic_search),
        )
        .route("/api/search/ask", post(ask::ask))
        .route("/api/agent/ask", post(agent_http::agent_ask))
        .route("/api/files/{id}/pii", post(pii_http::scan_file_pii))
        .route(
            "/api/files/{id}/summary",
            post(summary_http::summarize_file),
        )
        .route("/api/mcp", post(mcp_http::mcp_endpoint))
        .with_state(state.clone())
        .merge(wopi_router)
        .merge(auth_router)
        .merge(files_router)
        .merge(collab_router)
        .merge(versions_router)
        .merge(diff::router(state.clone()))
        .merge(share_router)
        .merge(workspaces_router)
        .merge(workspace_storage_router)
        .merge(oidc_router)
        .merge(direct_upload_router)
        .merge(notes_router)
        .merge(admin_users_router)
        .merge(compliance_router)
        .merge(presence_router)
        .merge(invitations_router)
        .merge(grants_router)
        .merge(members_router)
        .merge(projects_router)
        .merge(tags_router)
        .merge(tokens_router)
        // SPA fallback — `/`, `/sign-in`, `/files/...`, hashed asset paths
        // — anything not matched above is served from the embedded `web/dist/`.
        .fallback(spa::serve)
        // Security headers (app-origin profile).
        .layer(SetResponseHeaderLayer::overriding(
            H_CSP,
            HeaderValue::from_static(APP_CSP),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            H_XCTO,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            H_REF,
            HeaderValue::from_static(REFERRER_POLICY),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            H_PP,
            HeaderValue::from_static(PERMISSIONS_POLICY),
        ))
        // HSTS — production only. `None` makes the layer a no-op so the dev/test
        // http server never pins localhost to HTTPS. `overriding` with an
        // `Option` keeps the layer-stack type identical to the prod branch.
        .layer(SetResponseHeaderLayer::overriding(
            H_HSTS,
            state.config.is_prod.then(|| HeaderValue::from_static(HSTS)),
        ))
        // Host-header dispatch (421 on wrong origin) — outermost so even
        // wrong-host requests get rejected before any other middleware fires.
        .layer(middleware::from_fn_with_state(
            state,
            |s: State<HttpState>, req, next| host_dispatch(s, Origin::App, req, next),
        ))
}

fn usercontent_router(state: HttpState) -> Router {
    // /healthz lives on the app origin only — probes hit the app side; this
    // origin's health is implied by /raw/{token} working. Avoids the
    // merge-time route-conflict panic from declaring /healthz twice.
    Router::new()
        .route("/raw/{token}", get(raw::raw_get))
        .with_state(state.clone())
        // User-content origin: sandbox CSP, nosniff. Cookies must never be
        // set on this origin — but we don't even mount session middleware,
        // so this is by construction.
        .layer(SetResponseHeaderLayer::overriding(
            H_CSP,
            HeaderValue::from_static(UCN_CSP),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            H_XCTO,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(middleware::from_fn_with_state(
            state,
            |s: State<HttpState>, req, next| host_dispatch(s, Origin::UserContent, req, next),
        ))
}
