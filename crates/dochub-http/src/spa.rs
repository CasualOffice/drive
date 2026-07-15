//! SPA mount via `rust-embed`. The built assets in `web/dist/` are baked
//! into the binary at compile time (release) or read from disk in dev.
//! Unknown paths fall back to `index.html` so client-side routing works.

use axum::{
    body::Body,
    extract::Request,
    http::{header, HeaderValue, StatusCode, Uri},
    response::{IntoResponse, Response},
};
use rust_embed::Embed;

#[derive(Embed)]
#[folder = "../../web/dist/"]
struct Assets;

pub(crate) async fn serve(req: Request) -> Response {
    let path = req.uri().path();
    // An unmatched `/api/...` route must NOT fall through to the SPA shell.
    // A programmatic client (the SPA's own fetch layer, an MCP agent, a curl
    // script) expects the JSON error envelope and a real 404 — not a 200
    // carrying an HTML document it can't parse. This only fires for paths no
    // real API route matched, since routes are resolved before the fallback.
    if path == "/api" || path.starts_with("/api/") {
        return crate::error::ApiError::not_found("no such API route").into_response();
    }
    serve_path(path.trim_start_matches('/'))
}

fn serve_path(path: &str) -> Response {
    // 1. Exact asset match (e.g. assets/index-abc.js).
    if let Some(file) = Assets::get(path) {
        return file_response(path, file.data.into_owned());
    }
    // 2. SPA-style fallback: any non-asset path serves index.html so the
    //    client router can resolve it. We DO NOT fall back for paths that
    //    look like static assets (have a `.` in the last segment) — those
    //    should 404 honestly.
    let last = path.rsplit('/').next().unwrap_or("");
    if last.contains('.') {
        return StatusCode::NOT_FOUND.into_response();
    }
    if let Some(idx) = Assets::get("index.html") {
        return file_response("index.html", idx.data.into_owned());
    }
    // No index.html means the SPA hasn't been built yet — return a small
    // placeholder so dev clicks don't 404 silently.
    let placeholder = b"<!doctype html><meta charset=utf-8><title>Doc-Hub</title>\
        <p style=\"font-family:system-ui;color:#666;padding:32px;\">\
        SPA is not built. Run <code>pnpm --filter casual-drive-web build</code> first.</p>";
    let mut r: Response = (StatusCode::OK, placeholder.as_ref()).into_response();
    r.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    r
}

fn file_response(path: &str, data: Vec<u8>) -> Response {
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let mut r = Response::new(Body::from(data));
    r.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(mime.as_ref())
            .unwrap_or(HeaderValue::from_static("application/octet-stream")),
    );
    // Hashed asset paths (e.g. assets/index-DRnv-db8.js) can be cached
    // forever; index.html must always revalidate.
    if path.starts_with("assets/") {
        r.headers_mut().insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=31536000, immutable"),
        );
    } else {
        r.headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    }
    r
}

#[allow(dead_code)]
fn _unused_uri(_: Uri) {}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;

    #[tokio::test]
    async fn unknown_api_route_is_json_404_not_spa_html() {
        let req = Request::builder()
            .uri("/api/definitely-not-a-route")
            .body(Body::empty())
            .unwrap();
        let resp = serve(req).await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
        let ct = resp
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        assert!(ct.contains("application/json"), "content-type was {ct:?}");
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(v["error"]["code"], "not_found");
    }

    #[tokio::test]
    async fn unknown_app_route_serves_the_spa_shell() {
        // A client-side route (no `.` in the last segment, not under /api) must
        // still resolve to the SPA shell so the browser router can handle it.
        let req = Request::builder()
            .uri("/documents/abc/history")
            .body(Body::empty())
            .unwrap();
        let resp = serve(req).await;
        assert_eq!(resp.status(), StatusCode::OK);
    }
}
