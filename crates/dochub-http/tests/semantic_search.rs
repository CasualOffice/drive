//! Integration tests for `GET /api/search/semantic` — Phase 5 RAG retrieval
//! over stored chunk embeddings. Real sqlite + in-memory storage; the offline
//! `LocalEmbedder` (no network) both embeds documents (via the embed_file job)
//! and the query (in the handler), so retrieval is deterministic.

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

async fn user_id(state: &HttpState) -> String {
    UserRepo::new(&state.db)
        .find_by_username("admin")
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

/// Drain every queued job (index_file + embed_file) through the real handlers.
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

async fn semantic(app: &axum::Router, cookie: &str, q: &str) -> Value {
    let encoded = q.replace(' ', "%20");
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/search/semantic?q={encoded}"))
                .header("host", APP)
                .header("cookie", cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK, "semantic q={q}");
    serde_json::from_slice(&r.into_body().collect().await.unwrap().to_bytes()).unwrap()
}

fn ids(body: &Value) -> Vec<String> {
    body.as_array()
        .unwrap()
        .iter()
        .map(|h| h["file_id"].as_str().unwrap().to_string())
        .collect()
}

#[tokio::test]
async fn requires_auth() {
    let app = router(fixture().await);
    let r = app
        .oneshot(
            Request::builder()
                .uri("/api/search/semantic?q=anything")
                .header("host", APP)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn empty_query_returns_empty() {
    let state = fixture().await;
    let app = router(state);
    let cookie = sign_in(&app).await;
    let body = semantic(&app, &cookie, "").await;
    assert!(body.as_array().unwrap().is_empty());
}

#[tokio::test]
async fn retrieves_semantically_relevant_file() {
    let state = fixture().await;
    let owner = user_id(&state).await;
    let ws = personal_ws(&state, &owner).await;

    let budget = make_file(
        &state,
        &ws,
        &owner,
        "finance.md",
        b"The annual budget covers marketing spend and travel reimbursement for the sales team.",
    )
    .await;
    make_file(
        &state,
        &ws,
        &owner,
        "recipe.md",
        b"A recipe for sourdough bread using rye flour, water, salt, and a wild yeast starter.",
    )
    .await;

    // Run the embed jobs so there are vectors to retrieve.
    drain_jobs(&state).await;

    let app = router(state);
    let cookie = sign_in(&app).await;

    let body = semantic(&app, &cookie, "marketing budget spend").await;
    let hits = ids(&body);
    assert!(!hits.is_empty(), "expected a semantic hit");
    // The finance doc is the closest passage; the sourdough doc shares no
    // vocabulary and falls below the score floor.
    assert_eq!(hits[0], budget);
    assert!(!hits.contains(&"recipe".to_string()));
    // Hit carries a snippet (the chunk text) and a positive score.
    assert!(body[0]["snippet"].as_str().unwrap().contains("budget"));
    assert!(body[0]["score"].as_f64().unwrap() > 0.05);
    assert_eq!(body[0]["kind"].as_str().unwrap(), "markdown");
}

#[tokio::test]
async fn no_embeddings_yields_no_hits() {
    // A workspace with no committed/embedded files returns nothing (not an error).
    let state = fixture().await;
    let app = router(state);
    let cookie = sign_in(&app).await;
    let body = semantic(&app, &cookie, "anything at all").await;
    assert!(body.as_array().unwrap().is_empty());
}
