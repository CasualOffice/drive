//! Integration tests for the version-history API (build spec §2 — P1.3):
//! `GET /versions`, `GET /versions/{seq}/content`, `POST /restore/{seq}`,
//! `GET /verify`. Real in-memory SQLite + memory storage, exercised end to end
//! through the assembled router with a signed-in session.

use std::{net::SocketAddr, sync::Arc};

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use bytes::Bytes;
use dochub_auth::{hash_password, AuthState};
use dochub_core::{Backend, Config};
use dochub_db::{AuditRepo, Db, FileVersionsRepo, NewUser, UserRepo};
use dochub_http::{router, HttpState};
use dochub_storage::Storage;
use dochub_wopi::WopiState;
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;
use url::Url;

const APP: &str = "drive.test";
const UCN: &str = "usercontent-drive.test";

async fn fixture() -> HttpState {
    let storage = Storage::memory([1u8; 32]).unwrap();
    let db = Db::connect("sqlite::memory:").await.unwrap();
    UserRepo::new(&db)
        .insert(&NewUser {
            username: "admin".into(),
            password_hash: hash_password("hunter2").unwrap(),
            is_admin: true,
        })
        .await
        .unwrap();
    UserRepo::new(&db)
        .insert(&NewUser {
            username: "bob".into(),
            password_hash: hash_password("bobpass").unwrap(),
            is_admin: false,
        })
        .await
        .unwrap();
    let cfg = Config {
        app_origin: Url::parse(&format!("http://{APP}")).unwrap(),
        usercontent_origin: Url::parse(&format!("http://{UCN}")).unwrap(),
        bind: "127.0.0.1:0".parse::<SocketAddr>().unwrap(),
        backend: Backend::Memory,
        fs_root: None,
        s3_bucket: None,
        s3_region: None,
        s3_endpoint: None,
        aws_access_key_id: None,
        aws_secret_access_key: None,
        db_url: "sqlite::memory:".into(),
        body_limit_mb: 100,
        signed_url_ttl_secs: 300,
        oidc: None,
        allow_password_auth: true,
        session_secret: vec![0u8; 32],
        wopi_hmac_secret: [2u8; 32],
        signed_url_hmac_secret: [1u8; 32],
        admin_user: "admin".into(),
        admin_password_hash: "$argon2id$test".into(),
        recipient_footer: true,
        is_prod: false,
        sheet_origin: None,
        document_origin: None,
        master_kek: dochub_core::dev_master_kek(),
    };
    let auth = AuthState::new(db.clone(), false, time::Duration::hours(1));
    let registry = HttpState::default_registry(storage.clone(), [0u8; 32]);
    HttpState {
        storage,
        wopi: WopiState::new(),
        db,
        auth,
        jwt_secret: Arc::new([2u8; 32]),
        config: Arc::new(cfg),
        upload_limiter: HttpState::default_upload_limiter(),
        registry,
        storage_secret_key: None,
        presence: dochub_http::presence::PresenceHub::new(),
    }
}

/// Sign in with the given credentials, returning the `name=value` cookie pair.
async fn sign_in(app: &axum::Router, user: &str, pass: &str) -> String {
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/sign-in")
                .header("host", APP)
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"username":"{user}","password":"{pass}"}}"#
                )))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    let set_cookie = r
        .headers()
        .get("set-cookie")
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    set_cookie.split(';').next().unwrap().to_string()
}

fn auth_req(
    method: &str,
    path: &str,
    cookie: &str,
    content_type: Option<&str>,
    body: Body,
) -> Request<Body> {
    let mut b = Request::builder()
        .method(method)
        .uri(path)
        .header("host", APP)
        .header("cookie", cookie);
    if let Some(ct) = content_type {
        b = b.header("content-type", ct);
    }
    b.body(body).unwrap()
}

async fn json_body(r: axum::http::Response<Body>) -> Value {
    let bytes = r.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}

fn build_multipart(boundary: &str, filename: &str, content_type: &str, bytes: &[u8]) -> Bytes {
    let mut out: Vec<u8> = Vec::new();
    out.extend_from_slice(b"--");
    out.extend_from_slice(boundary.as_bytes());
    out.extend_from_slice(b"\r\n");
    out.extend_from_slice(
        format!(
            "Content-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n\
             Content-Type: {content_type}\r\n\r\n"
        )
        .as_bytes(),
    );
    out.extend_from_slice(bytes);
    out.extend_from_slice(b"\r\n--");
    out.extend_from_slice(boundary.as_bytes());
    out.extend_from_slice(b"--\r\n");
    Bytes::from(out)
}

/// Upload a fresh file with `bytes` as seq=1, returning its id.
async fn upload(app: &axum::Router, cookie: &str, bytes: &[u8]) -> String {
    let boundary = "----vbound";
    let body = build_multipart(boundary, "doc.txt", "text/plain", bytes);
    let r = app
        .clone()
        .oneshot(auth_req(
            "POST",
            "/api/files",
            cookie,
            Some(&format!("multipart/form-data; boundary={boundary}")),
            Body::from(body),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    json_body(r).await["id"].as_str().unwrap().to_string()
}

/// Commit a new head version via the SDK `PUT /content` path.
async fn put_content(app: &axum::Router, cookie: &str, id: &str, bytes: &[u8]) {
    let r = app
        .clone()
        .oneshot(auth_req(
            "PUT",
            &format!("/api/files/{id}/content"),
            cookie,
            Some("application/octet-stream"),
            Body::from(bytes.to_vec()),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
}

/// Upload + two saves → three versions, listed head first with intact
/// `seq`/`prev_hash` linkage.
#[tokio::test]
async fn versions_lists_chain_head_first() {
    let app = router(fixture().await);
    let cookie = sign_in(&app, "admin", "hunter2").await;
    let id = upload(&app, &cookie, b"v1 body").await;
    put_content(&app, &cookie, &id, b"v2 body").await;
    put_content(&app, &cookie, &id, b"v3 body").await;

    let r = app
        .clone()
        .oneshot(auth_req(
            "GET",
            &format!("/api/files/{id}/versions"),
            &cookie,
            None,
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    let list = json_body(r).await;
    let arr = list.as_array().unwrap();
    assert_eq!(arr.len(), 3, "three committed versions");

    // Head first: seq 3, 2, 1.
    assert_eq!(arr[0]["seq"], 3);
    assert_eq!(arr[1]["seq"], 2);
    assert_eq!(arr[2]["seq"], 1);

    // seq=1 has no predecessor; each later version's prev_hash chains back to
    // the previous version's content_hash.
    assert!(arr[2]["prev_hash"].is_null());
    assert_eq!(arr[0]["prev_hash"], arr[1]["content_hash"]);
    assert_eq!(arr[1]["prev_hash"], arr[2]["content_hash"]);

    // The internal storage_key is never leaked.
    assert!(arr[0].get("storage_key").is_none());
}

/// Each version's content endpoint returns exactly the bytes committed at that
/// seq; an unknown seq is a 404.
#[tokio::test]
async fn version_content_returns_exact_bytes_per_seq() {
    let app = router(fixture().await);
    let cookie = sign_in(&app, "admin", "hunter2").await;
    let id = upload(&app, &cookie, b"first").await;
    put_content(&app, &cookie, &id, b"second").await;
    put_content(&app, &cookie, &id, b"third").await;

    for (seq, want) in [(1, "first"), (2, "second"), (3, "third")] {
        let r = app
            .clone()
            .oneshot(auth_req(
                "GET",
                &format!("/api/files/{id}/versions/{seq}/content"),
                &cookie,
                None,
                Body::empty(),
            ))
            .await
            .unwrap();
        assert_eq!(r.status(), StatusCode::OK, "seq {seq} should be 200");
        let bytes = r.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(bytes.as_ref(), want.as_bytes(), "seq {seq} bytes");
    }

    // Unknown seq → 404.
    let r = app
        .clone()
        .oneshot(auth_req(
            "GET",
            &format!("/api/files/{id}/versions/99/content"),
            &cookie,
            None,
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::NOT_FOUND);
}

/// Restore is additive: it creates a new head equal to the target seq's bytes
/// and emits a `version.restore` audit row.
#[tokio::test]
async fn restore_creates_new_head_and_audits() {
    let state = fixture().await;
    let db = state.db.clone();
    let app = router(state);
    let cookie = sign_in(&app, "admin", "hunter2").await;
    let id = upload(&app, &cookie, b"original").await;
    put_content(&app, &cookie, &id, b"edited").await;

    // Restore seq=1 → new head at seq=3 with the original bytes.
    let r = app
        .clone()
        .oneshot(auth_req(
            "POST",
            &format!("/api/files/{id}/restore/1"),
            &cookie,
            None,
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    let head = json_body(r).await;
    assert_eq!(head["seq"], 3, "restore appends a new head");

    // The new head's content equals seq=1's bytes.
    let r = app
        .clone()
        .oneshot(auth_req(
            "GET",
            &format!("/api/files/{id}/versions/3/content"),
            &cookie,
            None,
            Body::empty(),
        ))
        .await
        .unwrap();
    let bytes = r.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(bytes.as_ref(), b"original");

    // History is preserved — the chain now has 3 versions.
    let chain = FileVersionsRepo::new(&db).list_chain(&id).await.unwrap();
    assert_eq!(chain.len(), 3);

    // A version.restore audit row was written for this file.
    let rows = AuditRepo::new(&db)
        .list_filtered(&["version.restore"], 10)
        .await
        .unwrap();
    assert!(
        rows.iter().any(|e| e.target_id.as_deref() == Some(&id)),
        "expected a version.restore audit row for {id}"
    );
}

/// A good chain verifies intact; corrupting a stored blob makes verify report
/// the broken seq.
#[tokio::test]
async fn verify_reports_intact_then_broken() {
    let state = fixture().await;
    let storage = state.storage.clone();
    let db = state.db.clone();
    let app = router(state);
    let cookie = sign_in(&app, "admin", "hunter2").await;
    let id = upload(&app, &cookie, b"aaa").await;
    put_content(&app, &cookie, &id, b"bbb").await;
    put_content(&app, &cookie, &id, b"ccc").await;

    let r = app
        .clone()
        .oneshot(auth_req(
            "GET",
            &format!("/api/files/{id}/verify"),
            &cookie,
            None,
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    assert_eq!(json_body(r).await["status"], "intact");

    // Tamper with the seq=2 blob at rest (overwrite its content-addressed key).
    let chain = FileVersionsRepo::new(&db).list_chain(&id).await.unwrap();
    let victim = &chain[1];
    assert_eq!(victim.seq, 2);
    storage
        .put(&victim.storage_key, Bytes::from_static(b"TAMPERED"), None)
        .await
        .unwrap();

    let r = app
        .clone()
        .oneshot(auth_req(
            "GET",
            &format!("/api/files/{id}/verify"),
            &cookie,
            None,
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    let body = json_body(r).await;
    assert_eq!(body["status"], "broken");
    assert_eq!(body["at_seq"], 2, "break surfaces the 1-based seq");
}

/// The version surface is authenticated and owner-gated, exactly like the
/// sibling file endpoints.
#[tokio::test]
async fn versions_enforce_auth_and_ownership() {
    let app = router(fixture().await);
    let owner = sign_in(&app, "admin", "hunter2").await;
    let id = upload(&app, &owner, b"secret").await;

    // Unauthenticated → 401.
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/files/{id}/versions"))
                .header("host", APP)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::UNAUTHORIZED);

    // Authenticated as a different user → 403 across every version route.
    let bob = sign_in(&app, "bob", "bobpass").await;
    for (method, path) in [
        ("GET", format!("/api/files/{id}/versions")),
        ("GET", format!("/api/files/{id}/versions/1/content")),
        ("POST", format!("/api/files/{id}/restore/1")),
        ("GET", format!("/api/files/{id}/verify")),
    ] {
        let r = app
            .clone()
            .oneshot(auth_req(method, &path, &bob, None, Body::empty()))
            .await
            .unwrap();
        assert_eq!(r.status(), StatusCode::FORBIDDEN, "{method} {path} → 403");
    }
}
