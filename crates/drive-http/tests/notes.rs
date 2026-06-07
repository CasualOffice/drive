//! Integration tests for /api/notes/* — pipeline §8.11.
//! Spec: docs/research/09-notes-wiki.md.

use std::{net::SocketAddr, sync::Arc};

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use drive_auth::{hash_password, AuthState};
use drive_core::{Backend, Config};
use drive_db::{Db, NewUser, UserRepo, WorkspaceKind, WorkspaceRepo};
use drive_http::{router, HttpState};
use drive_storage::Storage;
use drive_wopi::WopiState;
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
            username: "alice".into(),
            password_hash: hash_password("hunter2hunter2").unwrap(),
            is_admin: true,
        })
        .await
        .unwrap();
    UserRepo::new(&db)
        .insert(&NewUser {
            username: "bob".into(),
            password_hash: hash_password("hunter2hunter2").unwrap(),
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
        session_secret: vec![0u8; 32],
        wopi_hmac_secret: [2u8; 32],
        signed_url_hmac_secret: [1u8; 32],
        admin_user: "alice".into(),
        admin_password_hash: "$argon2id$test".into(),
        recipient_footer: true,
        is_prod: false,
        sheet_origin: None,
        document_origin: None,
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
    }
}

async fn sign_in(app: &axum::Router, who: &str) -> String {
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/sign-in")
                .header("host", APP)
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"username":"{who}","password":"hunter2hunter2"}}"#
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

async fn personal_id(state: &HttpState, who: &str) -> String {
    let user = UserRepo::new(&state.db)
        .find_by_username(who)
        .await
        .unwrap();
    WorkspaceRepo::new(&state.db)
        .list_for_user(&user.id)
        .await
        .unwrap()
        .into_iter()
        .find(|w| matches!(w.kind, WorkspaceKind::Personal))
        .unwrap()
        .id
}

async fn json_send(
    app: &axum::Router,
    cookie: &str,
    method: &str,
    uri: &str,
    body: Value,
) -> (StatusCode, Value) {
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(uri)
                .header("host", APP)
                .header("cookie", cookie)
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = r.status();
    let bytes = r.into_body().collect().await.unwrap().to_bytes();
    let v: Value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, v)
}

async fn json_get(app: &axum::Router, cookie: &str, uri: &str) -> (StatusCode, Value) {
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(uri)
                .header("host", APP)
                .header("cookie", cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = r.status();
    let bytes = r.into_body().collect().await.unwrap().to_bytes();
    let v: Value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, v)
}

#[tokio::test]
async fn create_then_get_returns_body_and_backlinks() {
    let state = fixture().await;
    let app = router(state);
    let cookie = sign_in(&app, "alice").await;

    let (st, created) = json_send(
        &app,
        &cookie,
        "POST",
        "/api/notes",
        json!({"title": "Sprint planning"}),
    )
    .await;
    assert_eq!(st, StatusCode::CREATED);
    let id = created["id"].as_str().unwrap().to_string();
    assert_eq!(created["title"], "Sprint planning");
    assert_eq!(created["body"], "");

    let (st, fetched) = json_get(&app, &cookie, &format!("/api/notes/{id}")).await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(fetched["id"], id);
    assert!(fetched["backlinks"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn body_save_indexes_wiki_links() {
    let state = fixture().await;
    let app = router(state);
    let cookie = sign_in(&app, "alice").await;

    // Two pages: "Q3 roadmap" + "Weekly sync"; sync references the roadmap.
    let (_, roadmap) = json_send(
        &app,
        &cookie,
        "POST",
        "/api/notes",
        json!({"title": "Q3 roadmap"}),
    )
    .await;
    let roadmap_id = roadmap["id"].as_str().unwrap().to_string();
    let (_, sync) = json_send(
        &app,
        &cookie,
        "POST",
        "/api/notes",
        json!({"title": "Weekly sync"}),
    )
    .await;
    let sync_id = sync["id"].as_str().unwrap().to_string();

    // Write a body on `sync` that references `roadmap`.
    let (st, _) = json_send(
        &app,
        &cookie,
        "PATCH",
        &format!("/api/notes/{sync_id}"),
        json!({"body": "See [[Q3 roadmap]] for context."}),
    )
    .await;
    assert_eq!(st, StatusCode::OK);

    // Reading roadmap should now show sync as a backlink.
    let (st, roadmap_after) = json_get(&app, &cookie, &format!("/api/notes/{roadmap_id}")).await;
    assert_eq!(st, StatusCode::OK);
    let backlinks = roadmap_after["backlinks"].as_array().unwrap();
    assert_eq!(backlinks.len(), 1);
    assert_eq!(backlinks[0]["id"], sync_id);
    assert_eq!(backlinks[0]["title"], "Weekly sync");
}

#[tokio::test]
async fn dangling_link_resolves_when_target_created_later() {
    let state = fixture().await;
    let app = router(state);
    let cookie = sign_in(&app, "alice").await;

    // Create note A with a [[Future]] link; "Future" doesn't exist yet.
    let (_, a) = json_send(&app, &cookie, "POST", "/api/notes", json!({"title": "A"})).await;
    let a_id = a["id"].as_str().unwrap().to_string();
    json_send(
        &app,
        &cookie,
        "PATCH",
        &format!("/api/notes/{a_id}"),
        json!({"body": "Mentioning [[Future]] before it exists."}),
    )
    .await;

    // Create the "Future" note now.
    let (_, future) = json_send(
        &app,
        &cookie,
        "POST",
        "/api/notes",
        json!({"title": "Future"}),
    )
    .await;
    let future_id = future["id"].as_str().unwrap().to_string();

    // Backlinks on Future should include A.
    let (_, future_after) = json_get(&app, &cookie, &format!("/api/notes/{future_id}")).await;
    let backlinks = future_after["backlinks"].as_array().unwrap();
    assert!(backlinks.iter().any(|b| b["id"] == a_id.as_str()));
}

#[tokio::test]
async fn body_too_large_is_413() {
    let state = fixture().await;
    let app = router(state);
    let cookie = sign_in(&app, "alice").await;

    let (_, n) = json_send(&app, &cookie, "POST", "/api/notes", json!({"title": "Big"})).await;
    let id = n["id"].as_str().unwrap();
    let huge = "x".repeat(1_048_577);
    let (st, _) = json_send(
        &app,
        &cookie,
        "PATCH",
        &format!("/api/notes/{id}"),
        json!({"body": huge}),
    )
    .await;
    assert_eq!(st, StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn cross_workspace_member_gets_403() {
    let state = fixture().await;
    let alice_personal = personal_id(&state, "alice").await;
    let app = router(state);
    let alice_cookie = sign_in(&app, "alice").await;
    let bob_cookie = sign_in(&app, "bob").await;

    // Alice creates a note in her personal workspace.
    let (_, note) = json_send(
        &app,
        &alice_cookie,
        "POST",
        "/api/notes",
        json!({"title": "Private"}),
    )
    .await;
    let id = note["id"].as_str().unwrap();

    // Bob tries to fetch — 403.
    let (st, _) = json_get(&app, &bob_cookie, &format!("/api/notes/{id}")).await;
    assert_eq!(st, StatusCode::FORBIDDEN);

    // Bob's tree of Alice's workspace — 403.
    let (st, _) = json_get(
        &app,
        &bob_cookie,
        &format!("/api/notes/tree?workspace={alice_personal}"),
    )
    .await;
    assert_eq!(st, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn trash_then_restore_roundtrip() {
    let state = fixture().await;
    let app = router(state);
    let cookie = sign_in(&app, "alice").await;

    let (_, n) = json_send(
        &app,
        &cookie,
        "POST",
        "/api/notes",
        json!({"title": "Trashable"}),
    )
    .await;
    let id = n["id"].as_str().unwrap();

    let (st, _) = json_send(
        &app,
        &cookie,
        "POST",
        &format!("/api/notes/{id}/trash"),
        json!({}),
    )
    .await;
    assert_eq!(st, StatusCode::NO_CONTENT);

    let (_, tree) = json_get(&app, &cookie, "/api/notes/tree").await;
    let nodes = tree["nodes"].as_array().unwrap();
    assert!(!nodes.iter().any(|n| n["id"] == id));
    let trashed = tree["trashed"].as_array().unwrap();
    assert!(trashed.iter().any(|n| n["id"] == id));

    let (st, _) = json_send(
        &app,
        &cookie,
        "POST",
        &format!("/api/notes/{id}/restore"),
        json!({}),
    )
    .await;
    assert_eq!(st, StatusCode::NO_CONTENT);

    let (_, tree2) = json_get(&app, &cookie, "/api/notes/tree").await;
    assert!(tree2["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .any(|n| n["id"] == id));
}

#[tokio::test]
async fn cannot_make_a_note_its_own_descendant() {
    let state = fixture().await;
    let app = router(state);
    let cookie = sign_in(&app, "alice").await;

    let (_, a) = json_send(&app, &cookie, "POST", "/api/notes", json!({"title": "A"})).await;
    let a_id = a["id"].as_str().unwrap();
    let (_, b) = json_send(
        &app,
        &cookie,
        "POST",
        "/api/notes",
        json!({"title": "B", "parent_id": a_id}),
    )
    .await;
    let b_id = b["id"].as_str().unwrap();

    // Moving A under B → cycle.
    let (st, _) = json_send(
        &app,
        &cookie,
        "PATCH",
        &format!("/api/notes/{a_id}"),
        json!({"parent_id": b_id}),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST);

    // Moving A under itself → also rejected.
    let (st, _) = json_send(
        &app,
        &cookie,
        "PATCH",
        &format!("/api/notes/{a_id}"),
        json!({"parent_id": a_id}),
    )
    .await;
    assert_eq!(st, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn search_matches_title_and_body() {
    let state = fixture().await;
    let app = router(state);
    let cookie = sign_in(&app, "alice").await;

    let (_, runbook) = json_send(
        &app,
        &cookie,
        "POST",
        "/api/notes",
        json!({"title": "Incident runbook"}),
    )
    .await;
    let runbook_id = runbook["id"].as_str().unwrap();
    json_send(
        &app,
        &cookie,
        "PATCH",
        &format!("/api/notes/{runbook_id}"),
        json!({"body": "First step: page the on-call."}),
    )
    .await;

    // Title hit.
    let (_, hits) = json_get(&app, &cookie, "/api/notes/search?q=incident").await;
    assert_eq!(hits.as_array().unwrap().len(), 1);
    assert_eq!(hits[0]["id"], runbook_id);

    // Body hit.
    let (_, hits2) = json_get(&app, &cookie, "/api/notes/search?q=on-call").await;
    assert_eq!(hits2.as_array().unwrap().len(), 1);

    // Empty query.
    let (_, hits3) = json_get(&app, &cookie, "/api/notes/search?q=").await;
    assert_eq!(hits3.as_array().unwrap().len(), 0);
}
