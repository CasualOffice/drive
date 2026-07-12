//! Integration tests for `POST /api/search/ask` — Phase 5 RAG question
//! answering. Real sqlite + in-memory storage; the offline `LocalEmbedder`
//! (retrieval) and `ExtractiveAnswerer` (composition) make the whole loop
//! deterministic with no network.

use std::{net::SocketAddr, sync::Arc};

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use dochub_auth::{hash_password, AuthState};
use dochub_core::{Backend, Config};
use dochub_db::{
    Db, FileRepo, NewFile, NewUser, Registry, UserRepo, WorkspaceDeks, WorkspaceKind, WorkspaceRepo,
};
use dochub_http::{router, EmbedFileHandler, HttpState, IndexFileHandler};
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

async fn sign_in(app: &axum::Router) -> String {
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/sign-in")
                .header("host", APP)
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"username":"admin","password":"hunter2hunter2"}"#,
                ))
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

async fn personal_ws(state: &HttpState) -> (String, String) {
    let owner = UserRepo::new(&state.db)
        .find_by_username("admin")
        .await
        .unwrap()
        .id;
    let ws = WorkspaceRepo::new(&state.db)
        .list_for_user(&owner)
        .await
        .unwrap()
        .into_iter()
        .find(|w| matches!(w.kind, WorkspaceKind::Personal))
        .unwrap()
        .id;
    (owner, ws)
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
        .commit_version(ws, &id, content, owner, "upload")
        .await
        .unwrap();
    id
}

async fn drain_jobs(state: &HttpState) {
    let worker = dochub_worker::Worker::new(state.db.clone())
        .register(
            dochub_db::KIND_INDEX_FILE,
            Arc::new(IndexFileHandler::new(state.clone())),
        )
        .register(
            dochub_db::KIND_EMBED_FILE,
            Arc::new(EmbedFileHandler::new(state.clone())),
        );
    loop {
        let step = worker
            .run_once(time::OffsetDateTime::now_utc())
            .await
            .unwrap();
        if matches!(step, dochub_worker::Step::Idle) {
            break;
        }
    }
}

async fn ask(app: &axum::Router, cookie: &str, q: &str) -> (StatusCode, Value) {
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/search/ask")
                .header("host", APP)
                .header("cookie", cookie)
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"q":{}}}"#,
                    serde_json::to_string(q).unwrap()
                )))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = r.status();
    let body = r.into_body().collect().await.unwrap().to_bytes();
    let json = if body.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&body).unwrap_or(Value::Null)
    };
    (status, json)
}

#[tokio::test]
async fn requires_auth() {
    let app = router(fixture().await);
    let r = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/search/ask")
                .header("host", APP)
                .header("content-type", "application/json")
                .body(Body::from(r#"{"q":"anything"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn answers_from_document_with_citation() {
    let state = fixture().await;
    let (owner, ws) = personal_ws(&state).await;

    make_file(
        &state,
        &ws,
        &owner,
        "finance.md",
        b"The office is open on weekdays. Quarterly revenue is recognized when the service is delivered to the customer. Parking is free for staff.",
    )
    .await;
    make_file(
        &state,
        &ws,
        &owner,
        "recipe.md",
        b"Sourdough bread needs rye flour, water, salt, and a wild yeast starter.",
    )
    .await;

    drain_jobs(&state).await;

    let app = router(state);
    let cookie = sign_in(&app).await;

    let (status, body) = ask(&app, &cookie, "when is revenue recognized?").await;
    assert_eq!(status, StatusCode::OK);
    let answer = body["answer"].as_str().unwrap();
    assert!(
        answer.to_lowercase().contains("revenue is recognized"),
        "answer should extract the revenue sentence, got: {answer:?}"
    );
    // Cited the finance doc, not the recipe.
    let cites = body["citations"].as_array().unwrap();
    assert!(!cites.is_empty());
    assert_eq!(cites[0]["title"].as_str().unwrap(), "finance.md");
    assert!(cites[0]["snippet"].as_str().unwrap().contains("revenue"));
}

#[tokio::test]
async fn empty_question_returns_empty_answer() {
    let state = fixture().await;
    let app = router(state);
    let cookie = sign_in(&app).await;
    let (status, body) = ask(&app, &cookie, "   ").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["answer"].as_str().unwrap(), "");
    assert!(body["citations"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn no_relevant_content_returns_empty_answer() {
    let state = fixture().await;
    let (owner, ws) = personal_ws(&state).await;
    make_file(
        &state,
        &ws,
        &owner,
        "note.md",
        b"grocery list milk eggs bread",
    )
    .await;
    drain_jobs(&state).await;

    let app = router(state);
    let cookie = sign_in(&app).await;
    let (status, body) = ask(&app, &cookie, "explain quantum chromodynamics").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["answer"].as_str().unwrap(), "");
}
