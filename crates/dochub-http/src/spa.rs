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
    let path = req.uri().path().trim_start_matches('/');
    serve_path(path)
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
