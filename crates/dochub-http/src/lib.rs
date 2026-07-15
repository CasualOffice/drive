//! HTTP layer for Doc-Hub. Assembles the Axum router that serves both
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

use std::time::Duration;

use axum::{
    extract::State,
    http::{HeaderValue, StatusCode},
    middleware,
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use dochub_auth::AuthSession;
use dochub_wopi::WopiAppState;
use tokio::time::timeout;
use tower_http::{catch_panic::CatchPanicLayer, set_header::SetResponseHeaderLayer};

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
/// How long a single readiness probe may take before it's reported as failed.
/// Bounds the whole endpoint so a hung dependency can't make the probe itself
/// hang — a readiness check must always answer promptly.
const READYZ_PROBE_TIMEOUT: Duration = Duration::from_secs(5);

/// Run a dependency probe with a time bound: `false` if it errors *or* exceeds
/// `budget`. Keeps `readyz` responsive even when a backend (e.g. an unreachable
/// S3 endpoint) never returns.
async fn probe_ok<F, E>(fut: F, budget: Duration) -> bool
where
    F: std::future::Future<Output = Result<(), E>>,
{
    matches!(timeout(budget, fut).await, Ok(Ok(())))
}

async fn readyz(State(s): State<HttpState>) -> impl IntoResponse {
    // Both critical dependencies must be reachable to serve real traffic: the
    // metadata DB and the object store (a read-only probe — never writes). Each
    // is time-bounded so a hung backend fails the probe instead of hanging it.
    let db_ok = probe_ok(s.db.ping(), READYZ_PROBE_TIMEOUT).await;
    let storage_ok = probe_ok(s.storage.check(), READYZ_PROBE_TIMEOUT).await;
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
        // Catch a panic in any handler and turn it into the standard JSON 500
        // instead of dropping the connection with no response. Innermost of the
        // response layers so the security headers below still decorate the 500.
        .layer(CatchPanicLayer::custom(on_panic))
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
        // Same panic safety-net as the app origin.
        .layer(CatchPanicLayer::custom(on_panic))
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

/// Panic handler for [`CatchPanicLayer`]. A panic in a handler is a bug, not a
/// client error — but the client should still get a well-formed 500 (the same
/// JSON envelope every other error uses) rather than a reset connection, and
/// the server should stay up. We log the payload at `error` for the operator;
/// the detail is never surfaced in the response body (it could leak internals).
fn on_panic(err: Box<dyn std::any::Any + Send + 'static>) -> Response {
    let detail = panic_detail(err.as_ref());
    tracing::error!(
        target: "dochub_http::panic",
        detail = %detail,
        "handler panicked; converted to 500",
    );
    crate::error::ApiError::internal().into_response()
}

/// Best-effort extract a human string from a panic payload. `panic!("msg")`
/// and `panic!("{fmt}")` land as `&str` / `String` respectively; anything else
/// (a non-string payload) has no readable message.
fn panic_detail(err: &(dyn std::any::Any + Send)) -> String {
    if let Some(s) = err.downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = err.downcast_ref::<String>() {
        s.clone()
    } else {
        "unknown panic payload".to_string()
    }
}

/// How often the reaper runs, and how long a bucket may sit idle before it's
/// dropped. The TTL is well past the full-refill time of every limiter
/// (upload: 60s, AI: 100s), so an evicted bucket is always full — eviction is
/// lossless, the next request for that key just recreates it at capacity.
const LIMITER_REAP_INTERVAL: Duration = Duration::from_secs(300);
const LIMITER_IDLE_TTL: Duration = Duration::from_secs(900);

/// Periodically evict idle rate-limiter buckets so the in-memory maps don't
/// grow without bound on a long-running multi-user instance — otherwise one
/// bucket per distinct user/key lingers for the life of the process. Mirrors
/// [`spawn_indexer`] / `PresenceHub::spawn_sweep`; the caller holds the handle
/// to abort it on shutdown.
#[must_use]
pub fn spawn_limiter_reaper(state: HttpState) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(LIMITER_REAP_INTERVAL);
        // The first `interval` tick fires immediately; skip it — nothing has
        // accumulated at boot.
        ticker.tick().await;
        loop {
            ticker.tick().await;
            crate::ai::ai_limiter().evict_idle(LIMITER_IDLE_TTL);
            state.upload_limiter.evict_idle(LIMITER_IDLE_TTL);
            // Same bounding for the sign-in brute-force throttle (dochub-auth).
            dochub_auth::reap_idle_throttle(LIMITER_IDLE_TTL);
        }
    })
}

#[cfg(test)]
mod tests {
    use super::{on_panic, panic_detail, probe_ok, READYZ_PROBE_TIMEOUT};
    use std::time::Duration;

    #[test]
    fn panic_detail_reads_str_and_string_payloads() {
        // `panic!("literal")` → &str; `panic!("{}", x)` → String.
        let s: Box<dyn std::any::Any + Send> = Box::new("boom");
        assert_eq!(panic_detail(s.as_ref()), "boom");
        let s: Box<dyn std::any::Any + Send> = Box::new(String::from("dynamic boom"));
        assert_eq!(panic_detail(s.as_ref()), "dynamic boom");
        // A non-string payload has no readable message.
        let s: Box<dyn std::any::Any + Send> = Box::new(42u32);
        assert_eq!(panic_detail(s.as_ref()), "unknown panic payload");
    }

    #[tokio::test]
    async fn on_panic_returns_json_500_envelope() {
        use axum::body::to_bytes;
        let resp = on_panic(Box::new("kaboom"));
        assert_eq!(resp.status(), axum::http::StatusCode::INTERNAL_SERVER_ERROR);
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(v["error"]["code"], "internal");
        // The panic detail must never leak into the client-facing body.
        assert!(!bytes.windows(6).any(|w| w == b"kaboom"));
    }

    #[tokio::test]
    async fn panicking_route_yields_500_not_a_dropped_connection() {
        use axum::{body::Body, http::Request, routing::get, Router};
        use tower::ServiceExt; // oneshot
        use tower_http::catch_panic::CatchPanicLayer;

        let app = Router::new()
            .route(
                "/boom",
                get(|| async {
                    panic!("intentional test panic");
                    #[allow(unreachable_code)]
                    ""
                }),
            )
            .layer(CatchPanicLayer::custom(on_panic));

        let resp = app
            .oneshot(Request::builder().uri("/boom").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(resp.status(), axum::http::StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[tokio::test]
    async fn probe_ok_true_when_fast_and_ok() {
        assert!(probe_ok(async { Ok::<(), ()>(()) }, READYZ_PROBE_TIMEOUT).await);
    }

    #[tokio::test]
    async fn probe_ok_false_when_the_dependency_errors() {
        assert!(!probe_ok(async { Err::<(), ()>(()) }, READYZ_PROBE_TIMEOUT).await);
    }

    #[tokio::test]
    async fn probe_ok_false_when_the_dependency_hangs_past_the_budget() {
        // A backend that outlives the budget must fail the probe, not hang it.
        let slow = async {
            tokio::time::sleep(Duration::from_millis(200)).await;
            Ok::<(), ()>(())
        };
        assert!(!probe_ok(slow, Duration::from_millis(20)).await);
    }
}
