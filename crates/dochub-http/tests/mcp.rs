//! Integration tests for `POST /api/mcp` — the Model Context Protocol endpoint.
//! Real sqlite + in-memory storage + the offline embedder/answerer, so the
//! whole tool call (retrieve → answer) is deterministic and needs no network.

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
use serde_json::{json, Value};
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

async fn seed(state: &HttpState) {
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
    let id = ulid::Ulid::new().to_string();
    FileRepo::new(&state.db)
        .insert(&NewFile {
            id: id.clone(),
            parent_id: None,
            name: "finance.md".into(),
            size: 0,
            content_type: None,
            etag: None,
            owner_id: owner.clone(),
            workspace_id: ws.clone(),
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
        .commit_version(
            &ws,
            &id,
            b"Quarterly revenue is recognized when the service is delivered to the customer.",
            &owner,
            "upload",
        )
        .await
        .unwrap();

    // Drain the embed job so there are vectors to retrieve.
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
        if matches!(
            worker
                .run_once(time::OffsetDateTime::now_utc())
                .await
                .unwrap(),
            dochub_worker::Step::Idle
        ) {
            break;
        }
    }
}

async fn rpc(app: &axum::Router, cookie: &str, body: Value) -> (StatusCode, Value) {
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/mcp")
                .header("host", APP)
                .header("cookie", cookie)
                .header("content-type", "application/json")
                .body(Body::from(serde_json::to_vec(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = r.status();
    let bytes = r.into_body().collect().await.unwrap().to_bytes();
    let v = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, v)
}

#[tokio::test]
async fn requires_auth() {
    let app = router(fixture().await);
    let r = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/mcp")
                .header("host", APP)
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn initialize_and_tools_list() {
    let app = router(fixture().await);
    let cookie = sign_in(&app).await;

    let (st, init) = rpc(
        &app,
        &cookie,
        json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(init["result"]["serverInfo"]["name"], "casual-dochub");

    let (_, list) = rpc(
        &app,
        &cookie,
        json!({"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}),
    )
    .await;
    let names: Vec<&str> = list["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap())
        .collect();
    assert!(names.contains(&"semantic_search"));
    assert!(names.contains(&"ask"));
}

#[tokio::test]
async fn notification_returns_no_content() {
    let app = router(fixture().await);
    let cookie = sign_in(&app).await;
    // No `id` ⇒ notification ⇒ 204, empty body.
    let (st, body) = rpc(
        &app,
        &cookie,
        json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
    )
    .await;
    assert_eq!(st, StatusCode::NO_CONTENT);
    assert_eq!(body, Value::Null);
}

#[tokio::test]
async fn ask_tool_answers_with_sources() {
    let state = fixture().await;
    seed(&state).await;
    let app = router(state);
    let cookie = sign_in(&app).await;

    let (st, resp) = rpc(
        &app,
        &cookie,
        json!({
            "jsonrpc":"2.0","id":9,"method":"tools/call",
            "params":{"name":"ask","arguments":{"q":"when is revenue recognized?"}}
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(resp["result"]["isError"], false);
    let text = resp["result"]["content"][0]["text"].as_str().unwrap();
    assert!(
        text.to_lowercase().contains("revenue is recognized"),
        "answer should extract the revenue sentence: {text:?}"
    );
    assert!(
        text.contains("finance.md"),
        "should cite the source: {text:?}"
    );
}

#[tokio::test]
async fn semantic_search_tool_returns_hits() {
    let state = fixture().await;
    seed(&state).await;
    let app = router(state);
    let cookie = sign_in(&app).await;

    let (st, resp) = rpc(
        &app,
        &cookie,
        json!({
            "jsonrpc":"2.0","id":10,"method":"tools/call",
            "params":{"name":"semantic_search","arguments":{"q":"revenue recognition"}}
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(resp["result"]["isError"], false);
    let text = resp["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("finance.md"), "should list the doc: {text:?}");
}

#[tokio::test]
async fn bad_arguments_is_iserror() {
    let app = router(fixture().await);
    let cookie = sign_in(&app).await;
    let (st, resp) = rpc(
        &app,
        &cookie,
        json!({
            "jsonrpc":"2.0","id":11,"method":"tools/call",
            "params":{"name":"ask","arguments":{}}
        }),
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    // Missing `q` → tool reports an isError result (not a protocol error).
    assert_eq!(resp["result"]["isError"], true);
}
