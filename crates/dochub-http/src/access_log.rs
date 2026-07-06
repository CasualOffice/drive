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

use axum::{extract::Request, http::HeaderMap, middleware::Next, response::Response};
use dochub_auth::AuthSession;

/// Wrap every request with a timer + emit a structured access-log event
/// on response. Mount as `Router::layer(from_fn(access_log))` outermost
/// so the timing covers every other middleware in the stack.
pub async fn access_log(req: Request, next: Next) -> Response {
    let start = Instant::now();
    let method = req.method().clone();
    let uri = req.uri().clone();
    let request_id = request_id(req.headers());
    let client_ip = client_ip(req.headers());

    // Pull the AuthSession out of extensions *after* the handler has
    // run, so we capture the resolved user_id even if auth middleware
    // populated it later in the stack. Read it before consuming the
    // request, in case some inner layer drops the extension.
    let pre_user_id = req
        .extensions()
        .get::<AuthSession>()
        .map(|s| s.user_id.clone());

    let resp = next.run(req).await;

    let status = resp.status();
    let duration_us = start.elapsed().as_micros();
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
            request_id = request_id.as_deref().unwrap_or(""),
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
            request_id = request_id.as_deref().unwrap_or(""),
            "access",
        );
    }

    resp
}

/// Pull the first non-empty `X-Forwarded-For` hop, else `X-Real-IP`,
/// else nothing. We don't read the connection-level peer address
/// because the SPA terminates at a reverse proxy in every realistic
/// deployment and the connection's peer is the proxy.
fn client_ip(headers: &HeaderMap) -> Option<String> {
    if let Some(xff) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        if let Some(first) = xff.split(',').next() {
            let trimmed = first.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    headers
        .get("x-real-ip")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
}

/// Use the upstream `X-Request-Id` if the reverse proxy sets one
/// (Cloudflare / Fly / Nginx all do); otherwise None — the operator
/// can correlate by (timestamp, user_id, path).
fn request_id(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-request-id")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
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
    fn extract_workspace_from_path() {
        assert_eq!(
            extract_workspace("/api/workspaces/ws_01/members"),
            Some("ws_01")
        );
        assert_eq!(extract_workspace("/api/workspaces/"), None);
        assert_eq!(extract_workspace("/api/me"), None);
    }
}
