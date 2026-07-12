//! Integration tests for the tag endpoints: workspace tag CRUD + file
//! assignment, gated through F1's `dochub_authz` and audited. Mirrors the
//! self-contained harness used by `access_mgmt.rs`.

use std::{net::SocketAddr, sync::Arc};

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use dochub_auth::{hash_password, AuthState};
use dochub_core::{Backend, Config};
use dochub_db::{Db, FileRepo, NewFile, NewUser, ProjectRepo, UserRepo, WorkspaceRepo};
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

/// Non-admin user (so authz gates apply — a superadmin bypasses).
async fn mk_user(db: &Db, username: &str) -> String {
    UserRepo::new(db)
        .insert(&NewUser {
            username: username.into(),
            password_hash: hash_password("hunter2hunter2").unwrap(),
            is_admin: false,
        })
        .await
        .unwrap()
        .id
}

async fn sign_in(app: &axum::Router, username: &str) -> String {
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/sign-in")
                .header("host", APP)
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"username":"{username}","password":"hunter2hunter2"}}"#
                )))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK, "sign-in for {username}");
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

/// Owner's Personal workspace + default project + one file owned by them.
async fn seed_file(db: &Db, owner_id: &str, name: &str) -> (String, String) {
    let ws = WorkspaceRepo::new(db)
        .list_for_user(owner_id)
        .await
        .unwrap()
        .into_iter()
        .next()
        .unwrap()
        .id;
    let project = ProjectRepo::new(db).ensure_default(&ws).await.unwrap();
    let file_id = ulid::Ulid::new().to_string();
    FileRepo::new(db)
        .insert(&NewFile {
            id: file_id.clone(),
            name: name.into(),
            owner_id: owner_id.into(),
            workspace_id: ws.clone(),
            project_id: Some(project),
            ..Default::default()
        })
        .await
        .unwrap();
    (ws, file_id)
}

async fn send(
    app: &axum::Router,
    method: &str,
    uri: &str,
    cookie: &str,
    body: &str,
) -> (StatusCode, Value) {
    let req = Request::builder()
        .method(method)
        .uri(uri)
        .header("host", APP)
        .header("cookie", cookie)
        .header("content-type", "application/json")
        .body(if body.is_empty() {
            Body::empty()
        } else {
            Body::from(body.to_string())
        })
        .unwrap();
    let r = app.clone().oneshot(req).await.unwrap();
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
async fn tag_crud_and_file_assignment_roundtrip() {
    let state = fixture().await;
    let db = state.db.clone();
    let app = router(state);

    let owner = mk_user(&db, "owner").await;
    let (ws, file_id) = seed_file(&db, &owner, "Contract.pdf").await;
    let cookie = sign_in(&app, "owner").await;

    // Create a tag.
    let (st, body) = send(
        &app,
        "POST",
        &format!("/api/workspaces/{ws}/tags"),
        &cookie,
        r##"{"name":"legal","color":"#8B5CF6"}"##,
    )
    .await;
    assert_eq!(st, StatusCode::CREATED, "create tag");
    let tag_id = body["id"].as_str().unwrap().to_string();
    assert_eq!(body["name"], "legal");
    assert_eq!(body["color"], "#8B5CF6");

    // It shows in the workspace list.
    let (st, body) = send(
        &app,
        "GET",
        &format!("/api/workspaces/{ws}/tags"),
        &cookie,
        "",
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(body["tags"].as_array().unwrap().len(), 1);

    // Assign to the file, then read it back.
    let (st, _) = send(
        &app,
        "PUT",
        &format!("/api/files/{file_id}/tags/{tag_id}"),
        &cookie,
        "",
    )
    .await;
    assert_eq!(st, StatusCode::NO_CONTENT, "assign");

    let (st, body) = send(
        &app,
        "GET",
        &format!("/api/files/{file_id}/tags"),
        &cookie,
        "",
    )
    .await;
    assert_eq!(st, StatusCode::OK);
    assert_eq!(body["tags"].as_array().unwrap().len(), 1);
    assert_eq!(body["tags"][0]["id"], tag_id);

    // Unassign.
    let (st, _) = send(
        &app,
        "DELETE",
        &format!("/api/files/{file_id}/tags/{tag_id}"),
        &cookie,
        "",
    )
    .await;
    assert_eq!(st, StatusCode::NO_CONTENT, "unassign");
    let (_, body) = send(
        &app,
        "GET",
        &format!("/api/files/{file_id}/tags"),
        &cookie,
        "",
    )
    .await;
    assert!(body["tags"].as_array().unwrap().is_empty());

    // Delete the tag.
    let (st, _) = send(
        &app,
        "DELETE",
        &format!("/api/workspaces/{ws}/tags/{tag_id}"),
        &cookie,
        "",
    )
    .await;
    assert_eq!(st, StatusCode::NO_CONTENT, "delete tag");
    let (_, body) = send(
        &app,
        "GET",
        &format!("/api/workspaces/{ws}/tags"),
        &cookie,
        "",
    )
    .await;
    assert!(body["tags"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn create_tag_forbidden_for_non_member() {
    let state = fixture().await;
    let db = state.db.clone();
    let app = router(state);

    let owner = mk_user(&db, "owner").await;
    let (ws, _file) = seed_file(&db, &owner, "Contract.pdf").await;
    // A second, unrelated user with no access to `ws`.
    mk_user(&db, "stranger").await;
    let cookie = sign_in(&app, "stranger").await;

    let (st, _) = send(
        &app,
        "POST",
        &format!("/api/workspaces/{ws}/tags"),
        &cookie,
        r#"{"name":"sneaky"}"#,
    )
    .await;
    assert_eq!(st, StatusCode::FORBIDDEN, "non-member cannot create tags");
}
