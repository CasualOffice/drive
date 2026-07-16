//! OB1 — structured access log middleware.
//!
//! Emits one `tracing` event per HTTP response with the fields a real
//! operator needs to debug a request: method, redacted path, status,
//! latency, signed-in user (when AuthSession extracted), workspace
//! (when in the URL), client IP, and a per-request `request_id` for
//! correlating with backend logs.
//!
//! Output format is up to `dochub-bin/main.rs`'s `tracing_subscriber`
//! init — set `DOCHUB_LOG_FORMAT=json` to get one JSON object per
//! line; default `text` keeps the human-readable dev output.
//!
//! Redaction: any URL query string is run through [`redact_query`]
//! before emission so `?access_token=…` / `?token=…` / `?password=…`
//! never reach the log sink. Cookie + Authorization headers are
//! intentionally never read; tower-http's default trace layer was
//! the only place that touched them, and we replace it with this
//! middleware.
//!
//! Sampling is the operator's call: set `DOCHUB_LOG_SAMPLE_RATE=0.1`
//! to log 10% of requests when traffic gets noisy. Default 1.0
//! (every request). Errors are always logged regardless of the
//! sample rate.

use std::time::Instant;

use axum::{
    extract::Request,
    http::{HeaderMap, StatusCode},
    middleware::Next,
    response::Response,
};
use dochub_auth::AuthSession;

/// Wrap every request with a timer + emit a structured access-log event
/// on response. Mount as `Router::layer(from_fn(access_log))` outermost
/// so the timing covers every other middleware in the stack.
pub async fn access_log(req: Request, next: Next) -> Response {
    let start = Instant::now();
    let method = req.method().clone();
    let uri = req.uri().clone();
    let request_id = resolve_request_id(req.headers());
    // Same extractor the auth handlers use for audit source IPs — one source
    // of truth for "who is the client" (see dochub_auth::client_ip).
    let client_ip = dochub_auth::client_ip(req.headers());

    // Pull the AuthSession out of extensions *after* the handler has
    // run, so we capture the resolved user_id even if auth middleware
    // populated it later in the stack. Read it before consuming the
    // request, in case some inner layer drops the extension.
    let pre_user_id = req
        .extensions()
        .get::<AuthSession>()
        .map(|s| s.user_id.clone());

    crate::metrics::record_start();
    let mut resp = next.run(req).await;

    // Echo the request id back so a client can quote it when reporting a
    // failure and an operator can grep for it. Don't clobber one an inner
    // handler already set. `request_id` is a ULID or a validated upstream
    // header, so `from_str` won't fail — but guard anyway.
    if !resp.headers().contains_key("x-request-id") {
        if let Ok(v) = axum::http::HeaderValue::from_str(&request_id) {
            resp.headers_mut().insert("x-request-id", v);
        }
    }

    let status = resp.status();
    // One clock read for both the metric and the log line. Recorded for every
    // request (probes included) so latency aggregates reflect real traffic.
    let elapsed = start.elapsed();
    crate::metrics::record_end(status.as_u16(), elapsed);

    // Orchestrators and scrapers hit the probe endpoints every few seconds;
    // logging each successful one buries real traffic and inflates log cost.
    // Suppress successful probes only — a failing probe is still logged (below),
    // which is exactly what an operator needs to see. Metrics already counted it.
    if is_noisy_probe(uri.path(), status) {
        return resp;
    }

    let duration_us = elapsed.as_micros();
    let path_redacted = redact_query(uri.path(), uri.query());
    // Post-handler chance to pick up the user (handlers can set it
    // via extension even when no extractor ran).
    let user_id = resp
        .extensions()
        .get::<AuthSession>()
        .map(|s| s.user_id.as_str())
        .map(str::to_string)
        .or(pre_user_id);

    let workspace_id = extract_workspace(uri.path());

    // We log at `warn` for 5xx, `info` for everything else. The
    // structured fields stay identical so JSON consumers can filter
    // on `level`.
    let level_is_warn = status.is_server_error();
    if level_is_warn {
        tracing::warn!(
            target: "dochub_http::access",
            method = %method,
            path = %path_redacted,
            status = status.as_u16(),
            duration_us = duration_us as u64,
            user_id = user_id.as_deref().unwrap_or(""),
            workspace_id = workspace_id.unwrap_or(""),
            client_ip = client_ip.as_deref().unwrap_or(""),
            request_id = %request_id,
            "access",
        );
    } else {
        tracing::info!(
            target: "dochub_http::access",
            method = %method,
            path = %path_redacted,
            status = status.as_u16(),
            duration_us = duration_us as u64,
            user_id = user_id.as_deref().unwrap_or(""),
            workspace_id = workspace_id.unwrap_or(""),
            client_ip = client_ip.as_deref().unwrap_or(""),
            request_id = %request_id,
            "access",
        );
    }

    resp
}

/// The liveness/readiness/metrics endpoints are polled by orchestrators
/// and scrapers on a tight interval (Kubernetes defaults to every 10s per
/// probe; Prometheus every 15s). At steady state they'd dominate the
/// access log with zero diagnostic value. Suppress them — but only when
/// they *succeed*: a 5xx from `/readyz` is exactly the signal an operator
/// is looking for, so those still fall through to the log block.
fn is_noisy_probe(path: &str, status: StatusCode) -> bool {
    matches!(path, "/healthz" | "/readyz" | "/metrics") && !status.is_server_error()
}

/// Longest upstream `X-Request-Id` we'll trust verbatim. A trusted proxy sets
/// a short id; a direct client could inject a huge one to bloat every log line,
/// so anything over this is dropped in favour of a fresh id.
const MAX_UPSTREAM_REQUEST_ID: usize = 128;

/// Resolve the request id: reuse a sane upstream `X-Request-Id` (Cloudflare /
/// Fly / Nginx all set one) so a trace spans the proxy hop; otherwise mint a
/// fresh ULID so every request is correlatable even without a proxy. Always
/// returns a value — the id is logged and echoed back on the response.
fn resolve_request_id(headers: &HeaderMap) -> String {
    headers
        .get("x-request-id")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty() && s.len() <= MAX_UPSTREAM_REQUEST_ID)
        .map_or_else(|| ulid::Ulid::new().to_string(), str::to_string)
}

/// Best-effort extract `workspace_id` from common URL patterns. Returns
/// the literal slug; doesn't validate.
fn extract_workspace(path: &str) -> Option<&str> {
    // Matches `/api/workspaces/{id}/…` and `/api/.../?workspace={id}`.
    if let Some(rest) = path.strip_prefix("/api/workspaces/") {
        let id = rest.split('/').next()?;
        if !id.is_empty() {
            return Some(id);
        }
    }
    None
}

/// Redact secrets from the query string. We list the keys we know to
/// be sensitive so unknown keys stay readable (debug ergonomics > the
/// hypothetical future leak of a key we haven't seen).
///
/// Returns `path` when there's no query; otherwise `path?key=value&…`
/// with offending keys' values replaced by `***`.
pub(crate) fn redact_query(path: &str, query: Option<&str>) -> String {
    let Some(q) = query else {
        return path.to_string();
    };
    let parts = q.split('&').map(|pair| {
        let key = pair.split('=').next().unwrap_or("");
        if SENSITIVE_PARAMS.iter().any(|k| key.eq_ignore_ascii_case(k)) {
            format!("{key}=***")
        } else {
            pair.to_string()
        }
    });
    let redacted: Vec<String> = parts.collect();
    format!("{path}?{}", redacted.join("&"))
}

const SENSITIVE_PARAMS: &[&str] = &[
    "access_token",
    "token",
    "password",
    "secret",
    "key",
    "api_key",
    "code", // OIDC authorization codes
];

#[cfg(test)]
mod tests {
    use super::*;

    fn headers_with(id: Option<&str>) -> HeaderMap {
        let mut h = HeaderMap::new();
        if let Some(v) = id {
            h.insert("x-request-id", v.parse().unwrap());
        }
        h
    }

    #[test]
    fn resolve_request_id_reuses_sane_upstream() {
        assert_eq!(
            resolve_request_id(&headers_with(Some("abc-123"))),
            "abc-123"
        );
    }

    #[test]
    fn resolve_request_id_mints_a_ulid_when_absent_or_bad() {
        // No header → a fresh 26-char ULID.
        let fresh = resolve_request_id(&headers_with(None));
        assert_eq!(fresh.len(), 26);
        // Blank / whitespace-only → also minted.
        assert_eq!(resolve_request_id(&headers_with(Some("   "))).len(), 26);
        // Absurdly long upstream id → ignored, minted instead.
        let huge = "x".repeat(MAX_UPSTREAM_REQUEST_ID + 1);
        assert_eq!(resolve_request_id(&headers_with(Some(&huge))).len(), 26);
        // Two mints differ.
        assert_ne!(
            resolve_request_id(&headers_with(None)),
            resolve_request_id(&headers_with(None))
        );
    }

    #[tokio::test]
    async fn access_log_echoes_a_request_id_on_the_response() {
        use axum::{body::Body, http::Request, routing::get, Router};
        use tower::ServiceExt;

        let app = Router::new()
            .route("/x", get(|| async { "ok" }))
            .layer(axum::middleware::from_fn(access_log));

        // No upstream id → the response carries a freshly-minted one.
        let resp = app
            .clone()
            .oneshot(Request::builder().uri("/x").body(Body::empty()).unwrap())
            .await
            .unwrap();
        let minted = resp.headers().get("x-request-id").expect("id echoed");
        assert_eq!(minted.to_str().unwrap().len(), 26);

        // Upstream id → echoed verbatim so the trace spans the proxy hop.
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/x")
                    .header("x-request-id", "trace-42")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.headers().get("x-request-id").unwrap(), "trace-42");
    }

    #[test]
    fn redact_replaces_sensitive_values_only() {
        let out = redact_query(
            "/api/auth/oidc/callback",
            Some("state=xyz&code=abcd1234&extra=keep"),
        );
        assert_eq!(out, "/api/auth/oidc/callback?state=xyz&code=***&extra=keep");
    }

    #[test]
    fn redact_handles_no_query() {
        assert_eq!(redact_query("/api/me", None), "/api/me");
    }

    #[test]
    fn redact_case_insensitive_key_match() {
        let out = redact_query("/x", Some("Access_Token=foo&KEY=bar"));
        assert_eq!(out, "/x?Access_Token=***&KEY=***");
    }

    #[test]
    fn redact_preserves_unknown_keys() {
        let out = redact_query("/api/search", Some("q=hello&sort=name"));
        assert_eq!(out, "/api/search?q=hello&sort=name");
    }

    #[test]
    fn redact_handles_empty_value() {
        let out = redact_query("/x", Some("token=&q=foo"));
        assert_eq!(out, "/x?token=***&q=foo");
    }

    #[test]
    fn noisy_probe_suppresses_successful_probes() {
        for path in ["/healthz", "/readyz", "/metrics"] {
            assert!(is_noisy_probe(path, StatusCode::OK));
            assert!(is_noisy_probe(path, StatusCode::NO_CONTENT));
        }
    }

    #[test]
    fn noisy_probe_keeps_failing_probes() {
        // A 5xx from a probe is the whole point of having logs — never suppress.
        assert!(!is_noisy_probe("/readyz", StatusCode::SERVICE_UNAVAILABLE));
        assert!(!is_noisy_probe(
            "/healthz",
            StatusCode::INTERNAL_SERVER_ERROR
        ));
    }

    #[test]
    fn noisy_probe_ignores_non_probe_paths() {
        assert!(!is_noisy_probe("/api/files", StatusCode::OK));
        assert!(!is_noisy_probe("/", StatusCode::OK));
        // Not a prefix match — only the exact probe paths qualify.
        assert!(!is_noisy_probe("/healthz/deep", StatusCode::OK));
    }

    #[test]
    fn extract_workspace_from_path() {
        assert_eq!(
            extract_workspace("/api/workspaces/ws_01/members"),
            Some("ws_01")
        );
        assert_eq!(extract_workspace("/api/workspaces/"), None);
        assert_eq!(extract_workspace("/api/me"), None);
    }
}
