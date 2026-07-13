//! Integration tests for `POST /api/files/{id}/summary` — the HTTP surface over
//! the offline extractive summarizer. Real sqlite + in-memory storage; a
//! committed head is read back through the encrypted version engine, extracted,
//! and summarized.
//!
//! Covers: summarizes a document (bounded, extractive), respects `?sentences=`,
//! permission gating, unsupported formats, unauthenticated rejection, and an
//! `ai.summary` audit event.

use std::{net::SocketAddr, sync::Arc};

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use dochub_auth::{hash_password, AuthState};
use dochub_core::{Backend, Config};
use dochub_db::{
    AuditRepo, Db, FileRepo, NewFile, NewUser, Registry, UserRepo, WorkspaceDeks, WorkspaceKind,
    WorkspaceRepo,
};
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
            password_hash: hash_password("hunter2hunter2").unwrap(),
            is_admin: true,
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
        collab_url: None,
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

async fn add_user(state: &HttpState, username: &str) {
    UserRepo::new(&state.db)
        .insert(&NewUser {
            username: username.into(),
            password_hash: hash_password("hunter2hunter2").unwrap(),
            is_admin: false,
        })
        .await
        .unwrap();
}

async fn sign_in_as(app: &axum::Router, user: &str) -> String {
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/sign-in")
                .header("host", APP)
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"username":"{user}","password":"hunter2hunter2"}}"#
                )))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    r.headers()
        .get("set-cookie")
        .unwrap()
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string()
}

async fn user_id(state: &HttpState, username: &str) -> String {
    UserRepo::new(&state.db)
        .find_by_username(username)
        .await
        .unwrap()
        .id
}

async fn personal_ws(state: &HttpState, user_id: &str) -> String {
    WorkspaceRepo::new(&state.db)
        .list_for_user(user_id)
        .await
        .unwrap()
        .into_iter()
        .find(|w| matches!(w.kind, WorkspaceKind::Personal))
        .expect("seeded user must have a Personal workspace")
        .id
}

async fn make_file(state: &HttpState, ws: &str, owner: &str, name: &str, content: &[u8]) -> String {
    let id = ulid::Ulid::new().to_string();
    FileRepo::new(&state.db)
        .insert(&NewFile {
            id: id.clone(),
            parent_id: None,
            name: name.into(),
            size: content.len() as u64,
            content_type: None,
            etag: None,
            owner_id: owner.into(),
            workspace_id: ws.into(),
            project_id: None,
            storage_id: None,
            status: dochub_db::FileStatus::Ready,
            expected_size: None,
        })
        .await
        .unwrap();
    let deks = WorkspaceDeks::new(state.db.clone(), state.config.master_kek.clone());
    let registry = Registry::new(state.db.clone(), state.storage.clone(), deks);
    registry
        .commit_version(ws, &id, content, owner, "test upload")
        .await
        .unwrap();
    id
}

async fn summarize(app: &axum::Router, cookie: &str, id: &str, query: &str) -> (StatusCode, Value) {
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/files/{id}/summary{query}"))
                .header("host", APP)
                .header("cookie", cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = r.status();
    let bytes = r.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

const DOC: &[u8] = b"The onboarding guide explains how to reset your password. \
    Revenue recognition governs how subscription revenue is recorded. \
    Deferred subscription revenue is recognized over the contract term. \
    The office has a coffee machine on the third floor.";

#[tokio::test]
async fn summarizes_a_document() {
    let state = fixture().await;
    let admin = user_id(&state, "admin").await;
    let ws = personal_ws(&state, &admin).await;
    let id = make_file(&state, &ws, &admin, "brief.md", DOC).await;

    let app = router(state);
    let cookie = sign_in_as(&app, "admin").await;
    let (status, body) = summarize(&app, &cookie, &id, "?sentences=2").await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["supported"], true);
    let sentences = body["sentences"].as_array().unwrap();
    assert_eq!(sentences.len(), 2, "?sentences=2 should bound the summary");
    // Extractive: the summary is a subset of the source; the salient topic wins.
    assert!(body["summary"]
        .as_str()
        .unwrap()
        .to_lowercase()
        .contains("revenue"));
    assert!(!body["summary"]
        .as_str()
        .unwrap()
        .to_lowercase()
        .contains("coffee"));
}

#[tokio::test]
async fn sentence_count_is_clamped() {
    let state = fixture().await;
    let admin = user_id(&state, "admin").await;
    let ws = personal_ws(&state, &admin).await;
    let id = make_file(&state, &ws, &admin, "brief.md", DOC).await;

    let app = router(state);
    let cookie = sign_in_as(&app, "admin").await;
    // 999 is clamped to <= 10; the doc has 4 sentences, so all 4 come back.
    let (status, body) = summarize(&app, &cookie, &id, "?sentences=999").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["sentences"].as_array().unwrap().len(), 4);
}

#[tokio::test]
async fn a_user_who_cannot_view_the_file_is_refused() {
    let state = fixture().await;
    add_user(&state, "mallory").await;
    let admin = user_id(&state, "admin").await;
    let ws = personal_ws(&state, &admin).await;
    let id = make_file(&state, &ws, &admin, "private.md", DOC).await;

    let app = router(state);
    let cookie = sign_in_as(&app, "mallory").await;
    let (status, _) = summarize(&app, &cookie, &id, "").await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn unauthenticated_is_rejected() {
    let state = fixture().await;
    let admin = user_id(&state, "admin").await;
    let ws = personal_ws(&state, &admin).await;
    let id = make_file(&state, &ws, &admin, "n.md", DOC).await;

    let app = router(state);
    let (status, _) = summarize(&app, "", &id, "").await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn unsupported_format_reports_supported_false() {
    let state = fixture().await;
    let admin = user_id(&state, "admin").await;
    let ws = personal_ws(&state, &admin).await;
    let id = make_file(&state, &ws, &admin, "scan.pdf", b"%PDF-1.4 ...").await;

    let app = router(state);
    let cookie = sign_in_as(&app, "admin").await;
    let (status, body) = summarize(&app, &cookie, &id, "").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["supported"], false);
    assert_eq!(body["summary"], "");
}

#[tokio::test]
async fn summary_appends_an_audit_event() {
    let state = fixture().await;
    let admin = user_id(&state, "admin").await;
    let ws = personal_ws(&state, &admin).await;
    let id = make_file(&state, &ws, &admin, "audited.md", DOC).await;

    let app = router(state.clone());
    let cookie = sign_in_as(&app, "admin").await;
    let (status, _) = summarize(&app, &cookie, &id, "").await;
    assert_eq!(status, StatusCode::OK);

    let audit = AuditRepo::new(&state.db);
    let mut seen = false;
    for _ in 0..100 {
        let events = audit.list(None, 200).await.unwrap();
        seen = events
            .iter()
            .any(|e| e.action == "ai.summary" && e.target_id.as_deref() == Some(id.as_str()));
        if seen {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    assert!(seen, "an ai.summary event should be on the audit log");
}
