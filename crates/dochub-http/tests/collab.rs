//! Integration tests for the collab room-brokering API (build spec §3 — P2.2):
//! `GET /collab`, `GET /collab/seed`, `POST /collab/snapshot`. Real in-memory
//! SQLite + memory storage, exercised through the assembled router. Covers the
//! opt-in `DOCHUB_COLLAB_URL` gate, the editor-token contract (a token minted
//! for file A cannot seed/snapshot file B), the seed → decrypted head bytes
//! path, and the snapshot → new hash-chained version + `version.commit` audit.

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

/// Build a fixture; `collab` toggles whether `DOCHUB_COLLAB_URL` is set.
async fn fixture(collab: bool) -> HttpState {
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
        collab_url: collab.then(|| Url::parse("https://collab.test").unwrap()),
        master_kek: dochub_core::dev_master_kek(),
        master_kek_next: None,
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

/// A request carrying a bearer token instead of a session cookie — the
/// server-to-server shape the collab server uses for seed/snapshot.
fn bearer_req(method: &str, path: &str, token: Option<&str>, body: Body) -> Request<Body> {
    let mut b = Request::builder()
        .method(method)
        .uri(path)
        .header("host", APP);
    if let Some(t) = token {
        b = b.header("authorization", format!("Bearer {t}"));
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

async fn upload(app: &axum::Router, cookie: &str, bytes: &[u8]) -> String {
    let boundary = "----cbound";
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

/// Grant a room + editor token for `id`, returning the parsed grant JSON.
async fn grant(app: &axum::Router, cookie: &str, id: &str) -> Value {
    let r = app
        .clone()
        .oneshot(auth_req(
            "GET",
            &format!("/api/files/{id}/collab"),
            cookie,
            None,
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    json_body(r).await
}

// ─── Disabled gate ──────────────────────────────────────────────────────

/// With no `DOCHUB_COLLAB_URL`, all three endpoints 404 — co-editing is opt-in
/// and falls back to single-user (P2.1).
#[tokio::test]
async fn collab_disabled_returns_404() {
    let app = router(fixture(false).await);
    let cookie = sign_in(&app, "admin", "hunter2").await;
    let id = upload(&app, &cookie, b"body").await;

    let g = app
        .clone()
        .oneshot(auth_req(
            "GET",
            &format!("/api/files/{id}/collab"),
            &cookie,
            None,
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(g.status(), StatusCode::NOT_FOUND);

    let seed = app
        .clone()
        .oneshot(bearer_req(
            "GET",
            &format!("/api/files/{id}/collab/seed"),
            None,
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(seed.status(), StatusCode::NOT_FOUND);

    let snap = app
        .clone()
        .oneshot(bearer_req(
            "POST",
            &format!("/api/files/{id}/collab/snapshot"),
            None,
            Body::from("bytes"),
        ))
        .await
        .unwrap();
    assert_eq!(snap.status(), StatusCode::NOT_FOUND);
}

// ─── Grant ──────────────────────────────────────────────────────────────

/// Enabled: `GET /collab` returns a per-document room, a `ws(s)://…/yjs` url,
/// and a token that validates for *this* file (via the seed endpoint).
#[tokio::test]
async fn collab_grant_returns_room_ws_and_valid_token() {
    let app = router(fixture(true).await);
    let cookie = sign_in(&app, "admin", "hunter2").await;
    let id = upload(&app, &cookie, b"seed bytes").await;

    let g = grant(&app, &cookie, &id).await;
    assert_eq!(g["room"], id, "room id is the per-document file id");
    assert_eq!(g["ws_url"], "wss://collab.test/yjs");
    let token = g["token"].as_str().unwrap().to_string();
    assert!(token.len() > 16);

    // The token validates for this file — seed returns the head bytes.
    let r = app
        .clone()
        .oneshot(bearer_req(
            "GET",
            &format!("/api/files/{id}/collab/seed"),
            Some(&token),
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    let bytes = r.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(bytes.as_ref(), b"seed bytes");
}

/// A token minted for another file cannot seed this one → 403.
#[tokio::test]
async fn other_file_token_is_rejected_on_seed() {
    let app = router(fixture(true).await);
    let cookie = sign_in(&app, "admin", "hunter2").await;
    let id_a = upload(&app, &cookie, b"file A").await;
    let id_b = upload(&app, &cookie, b"file B").await;

    let token_b = grant(&app, &cookie, &id_b).await["token"]
        .as_str()
        .unwrap()
        .to_string();

    // Use B's token against A's seed → 403 (valid token, wrong file).
    let r = app
        .clone()
        .oneshot(bearer_req(
            "GET",
            &format!("/api/files/{id_a}/collab/seed"),
            Some(&token_b),
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::FORBIDDEN);

    // A missing/garbage token → 401 (unauthenticated), distinct from 403.
    let r = app
        .clone()
        .oneshot(bearer_req(
            "GET",
            &format!("/api/files/{id_a}/collab/seed"),
            Some("not-a-jwt"),
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::UNAUTHORIZED);

    let r = app
        .clone()
        .oneshot(bearer_req(
            "GET",
            &format!("/api/files/{id_a}/collab/seed"),
            None,
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::UNAUTHORIZED);
}

// ─── Snapshot ───────────────────────────────────────────────────────────

/// Snapshot commits the merged room bytes as a new hash-chained version
/// (chain length +1) and writes a `version.commit` audit row.
#[tokio::test]
async fn snapshot_commits_version_and_audits() {
    let state = fixture(true).await;
    let db = state.db.clone();
    let app = router(state);
    let cookie = sign_in(&app, "admin", "hunter2").await;
    let id = upload(&app, &cookie, b"v1").await;

    // seq=1 from the upload.
    assert_eq!(
        FileVersionsRepo::new(&db)
            .list_chain(&id)
            .await
            .unwrap()
            .len(),
        1
    );

    let token = grant(&app, &cookie, &id).await["token"]
        .as_str()
        .unwrap()
        .to_string();

    let r = app
        .clone()
        .oneshot(bearer_req(
            "POST",
            &format!("/api/files/{id}/collab/snapshot"),
            Some(&token),
            Body::from("merged room bytes"),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    assert_eq!(json_body(r).await["seq"], 2, "snapshot appends a new head");

    // Chain length +1.
    let chain = FileVersionsRepo::new(&db).list_chain(&id).await.unwrap();
    assert_eq!(chain.len(), 2);

    // The new head decrypts to exactly the snapshotted bytes.
    let r = app
        .clone()
        .oneshot(auth_req(
            "GET",
            &format!("/api/files/{id}/versions/2/content"),
            &cookie,
            None,
            Body::empty(),
        ))
        .await
        .unwrap();
    let bytes = r.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(bytes.as_ref(), b"merged room bytes");

    // A version.commit audit row exists for this file.
    let rows = AuditRepo::new(&db)
        .list_filtered(&["version.commit"], 10)
        .await
        .unwrap();
    assert!(
        rows.iter().any(|e| e.target_id.as_deref() == Some(&id)),
        "expected a version.commit audit row for {id}"
    );
}

/// Snapshot rejects a token for another file (403) and a missing token (401).
#[tokio::test]
async fn snapshot_rejects_other_file_and_unauthed() {
    let state = fixture(true).await;
    let db = state.db.clone();
    let app = router(state);
    let cookie = sign_in(&app, "admin", "hunter2").await;
    let id_a = upload(&app, &cookie, b"A").await;
    let id_b = upload(&app, &cookie, b"B").await;

    let token_b = grant(&app, &cookie, &id_b).await["token"]
        .as_str()
        .unwrap()
        .to_string();

    // B's token snapshotting A → 403.
    let r = app
        .clone()
        .oneshot(bearer_req(
            "POST",
            &format!("/api/files/{id_a}/collab/snapshot"),
            Some(&token_b),
            Body::from("x"),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::FORBIDDEN);

    // No token → 401.
    let r = app
        .clone()
        .oneshot(bearer_req(
            "POST",
            &format!("/api/files/{id_a}/collab/snapshot"),
            None,
            Body::from("x"),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::UNAUTHORIZED);

    // Neither rejection created a version — A still has just seq=1.
    assert_eq!(
        FileVersionsRepo::new(&db)
            .list_chain(&id_a)
            .await
            .unwrap()
            .len(),
        1
    );
}

// ─── Auth / ownership ───────────────────────────────────────────────────

/// The grant endpoint is session-authenticated and owner-gated: 401 without a
/// session, 403 for a non-owner.
#[tokio::test]
async fn grant_enforces_auth_and_ownership() {
    let app = router(fixture(true).await);
    let owner = sign_in(&app, "admin", "hunter2").await;
    let id = upload(&app, &owner, b"secret").await;

    // Unauthenticated → 401.
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/files/{id}/collab"))
                .header("host", APP)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::UNAUTHORIZED);

    // A different signed-in user → 403.
    let bob = sign_in(&app, "bob", "bobpass").await;
    let r = app
        .clone()
        .oneshot(auth_req(
            "GET",
            &format!("/api/files/{id}/collab"),
            &bob,
            None,
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::FORBIDDEN);

    // A non-owner cannot mint a token, so they cannot seed/snapshot either:
    // without a valid token the token-gated endpoints answer 401.
    for (method, suffix, body) in [
        ("GET", "seed", Body::empty()),
        ("POST", "snapshot", Body::from("x")),
    ] {
        let r = app
            .clone()
            .oneshot(bearer_req(
                method,
                &format!("/api/files/{id}/collab/{suffix}"),
                None,
                body,
            ))
            .await
            .unwrap();
        assert_eq!(
            r.status(),
            StatusCode::UNAUTHORIZED,
            "{method} /collab/{suffix} with no token → 401"
        );
    }
}

/// A non-owner with an Edit grant CAN get a collab grant — the grant is
/// authorized against live permissions (workspace membership + ACL), not raw
/// `owner_id`. Before the fix this returned 403 for a legitimately-shared
/// co-editor.
#[tokio::test]
async fn grant_allows_acl_editor_not_just_owner() {
    let app = router(fixture(true).await);
    let owner = sign_in(&app, "admin", "hunter2").await;
    let id = upload(&app, &owner, b"shared doc").await;

    // Owner shares Edit with bob via an ACL grant.
    let r = app
        .clone()
        .oneshot(auth_req(
            "POST",
            &format!("/api/files/{id}/grants"),
            &owner,
            Some("application/json"),
            Body::from(r#"{"user":"bob","role":"editor"}"#),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::CREATED);

    // Bob (not the owner) can now mint a collab room grant.
    let bob = sign_in(&app, "bob", "bobpass").await;
    let r = app
        .clone()
        .oneshot(auth_req(
            "GET",
            &format!("/api/files/{id}/collab"),
            &bob,
            None,
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(
        r.status(),
        StatusCode::OK,
        "an ACL-granted editor must be allowed a collab grant"
    );
    assert_eq!(json_body(r).await["room"], id);
}
