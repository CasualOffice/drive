//! Integration tests for the retention + legal-hold compliance layer
//! (build spec §3 — P1.2). Real sqlite, real router.
//!
//! Invariant #6: a held / retained document cannot be tombstoned or purged from
//! any path; releasing the hold re-permits it; retention blocks purge of
//! in-window versions but allows trash. Hold/retention mutations are audited and
//! authz-gated (non-admin → 403).

use std::{net::SocketAddr, sync::Arc};

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use bytes::Bytes;
use dochub_auth::{hash_password, AuthState};
use dochub_core::{Backend, Config};
use dochub_db::{AuditRepo, Db, NewUser, UserRepo, WorkspaceKind, WorkspaceRepo};
use dochub_http::{router, HttpState};
use dochub_storage::Storage;
use dochub_wopi::WopiState;
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;
use url::Url;

const APP: &str = "drive.test";
const UCN: &str = "usercontent-drive.test";

async fn fixture() -> (HttpState, Db) {
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
    let state = HttpState {
        storage,
        wopi: WopiState::new(),
        db: db.clone(),
        auth,
        jwt_secret: Arc::new([2u8; 32]),
        config: Arc::new(cfg),
        upload_limiter: HttpState::default_upload_limiter(),
        registry,
        storage_secret_key: None,
        presence: dochub_http::presence::PresenceHub::new(),
    };
    (state, db)
}

async fn add_user(db: &Db, name: &str, is_admin: bool) {
    UserRepo::new(db)
        .insert(&NewUser {
            username: name.into(),
            password_hash: hash_password("hunter2password").unwrap(),
            is_admin,
        })
        .await
        .unwrap();
}

/// Sign in, return the `Cookie:` header value.
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
    assert_eq!(r.status(), StatusCode::OK, "sign-in for {user}");
    let set_cookie = r
        .headers()
        .get("set-cookie")
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    set_cookie.split(';').next().unwrap().to_string()
}

fn auth_req(method: &str, path: &str, cookie: &str, ct: Option<&str>, body: Body) -> Request<Body> {
    let mut b = Request::builder()
        .method(method)
        .uri(path)
        .header("host", APP)
        .header("cookie", cookie);
    if let Some(ct) = ct {
        b = b.header("content-type", ct);
    }
    b.body(body).unwrap()
}

async fn json_body(r: axum::http::Response<Body>) -> Value {
    let bytes = r.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}

async fn personal_ws(db: &Db, username: &str) -> String {
    let user = UserRepo::new(db).find_by_username(username).await.unwrap();
    WorkspaceRepo::new(db)
        .list_for_user(&user.id)
        .await
        .unwrap()
        .into_iter()
        .find(|w| matches!(w.kind, WorkspaceKind::Personal))
        .expect("personal workspace")
        .id
}

/// Upload a text file (optionally under `parent_id`), return its id.
async fn upload(app: &axum::Router, cookie: &str, name: &str, parent_id: Option<&str>) -> String {
    let boundary = "----cbnd";
    let mut fields = vec![MultipartField::File(
        "file",
        name,
        "text/plain",
        b"hello world",
    )];
    if let Some(p) = parent_id {
        fields.insert(0, MultipartField::Text("parent_id", p));
    }
    let body = build_multipart(boundary, &fields);
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
    assert_eq!(r.status(), StatusCode::OK, "upload {name}");
    json_body(r).await["id"].as_str().unwrap().to_string()
}

async fn create_folder(app: &axum::Router, cookie: &str, name: &str) -> String {
    let r = app
        .clone()
        .oneshot(auth_req(
            "POST",
            "/api/folders",
            cookie,
            Some("application/json"),
            Body::from(format!(r#"{{"name":"{name}"}}"#)),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK, "create folder {name}");
    json_body(r).await["id"].as_str().unwrap().to_string()
}

async fn place_hold(
    app: &axum::Router,
    cookie: &str,
    ws: &str,
    kind: &str,
    target: Option<&str>,
) -> axum::http::Response<Body> {
    let target_json = match target {
        Some(t) => format!(r#","target_id":"{t}""#),
        None => String::new(),
    };
    let body = format!(
        r#"{{"workspace_id":"{ws}","target_kind":"{kind}"{target_json},"reason":"litigation hold"}}"#
    );
    app.clone()
        .oneshot(auth_req(
            "POST",
            "/api/holds",
            cookie,
            Some("application/json"),
            Body::from(body),
        ))
        .await
        .unwrap()
}

async fn trash(app: &axum::Router, cookie: &str, id: &str) -> StatusCode {
    app.clone()
        .oneshot(auth_req(
            "POST",
            &format!("/api/files/{id}/trash"),
            cookie,
            None,
            Body::empty(),
        ))
        .await
        .unwrap()
        .status()
}

async fn purge(app: &axum::Router, cookie: &str, id: &str) -> axum::http::Response<Body> {
    app.clone()
        .oneshot(auth_req(
            "POST",
            &format!("/api/files/{id}/purge"),
            cookie,
            None,
            Body::empty(),
        ))
        .await
        .unwrap()
}

/// Poll the audit log until at least one row for `action` shows up (emit is
/// fire-and-forget via a spawned task).
async fn wait_for_audit(db: &Db, action: &str) -> bool {
    for _ in 0..50 {
        let rows = AuditRepo::new(db)
            .list_filtered(&[action], 10)
            .await
            .unwrap();
        if !rows.is_empty() {
            return true;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    false
}

// ─── Tests ───────────────────────────────────────────────────────────────

#[tokio::test]
async fn oversized_hold_reason_is_rejected() {
    let (state, db) = fixture().await;
    let app = router(state);
    let cookie = sign_in(&app, "admin", "hunter2").await;
    let ws = personal_ws(&db, "admin").await;

    // A multi-KB reason would otherwise be persisted verbatim to the
    // append-only hold row; cap it with a 422.
    let big = "x".repeat(5001);
    let body = format!(r#"{{"workspace_id":"{ws}","target_kind":"workspace","reason":"{big}"}}"#);
    let r = app
        .clone()
        .oneshot(auth_req(
            "POST",
            "/api/holds",
            &cookie,
            Some("application/json"),
            Body::from(body),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::UNPROCESSABLE_ENTITY);

    // A normal reason is accepted.
    let ok = place_hold(&app, &cookie, &ws, "workspace", None).await;
    assert_eq!(ok.status(), StatusCode::CREATED);
}

#[tokio::test]
async fn file_hold_blocks_trash_and_purge_then_release_permits() {
    let (state, db) = fixture().await;
    let app = router(state);
    let cookie = sign_in(&app, "admin", "hunter2").await;
    let ws = personal_ws(&db, "admin").await;

    let file_id = upload(&app, &cookie, "held.txt", None).await;

    // Place a file-scoped hold.
    let r = place_hold(&app, &cookie, &ws, "file", Some(&file_id)).await;
    assert_eq!(r.status(), StatusCode::CREATED);
    let hold_id = json_body(r).await["id"].as_str().unwrap().to_string();

    // Trash + purge both rejected with 409 from every path.
    assert_eq!(trash(&app, &cookie, &file_id).await, StatusCode::CONFLICT);
    let pr = purge(&app, &cookie, &file_id).await;
    assert_eq!(pr.status(), StatusCode::CONFLICT);
    assert_eq!(json_body(pr).await["error"], "under legal hold");

    // Release the hold.
    let r = app
        .clone()
        .oneshot(auth_req(
            "DELETE",
            &format!("/api/holds/{hold_id}"),
            &cookie,
            None,
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    assert_eq!(json_body(r).await["active"], false);

    // Now trash succeeds.
    assert_eq!(trash(&app, &cookie, &file_id).await, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn project_scoped_hold_covers_files_in_it() {
    let (state, db) = fixture().await;
    let app = router(state);
    let cookie = sign_in(&app, "admin", "hunter2").await;
    let ws = personal_ws(&db, "admin").await;

    let folder_id = create_folder(&app, &cookie, "Litigation").await;
    let file_id = upload(&app, &cookie, "doc.txt", Some(&folder_id)).await;

    // Hold on the project (folder) covers files inside it.
    let r = place_hold(&app, &cookie, &ws, "project", Some(&folder_id)).await;
    assert_eq!(r.status(), StatusCode::CREATED);

    assert_eq!(trash(&app, &cookie, &file_id).await, StatusCode::CONFLICT);
    assert_eq!(
        purge(&app, &cookie, &file_id).await.status(),
        StatusCode::CONFLICT
    );
}

#[tokio::test]
async fn workspace_scoped_hold_covers_all_files() {
    let (state, db) = fixture().await;
    let app = router(state);
    let cookie = sign_in(&app, "admin", "hunter2").await;
    let ws = personal_ws(&db, "admin").await;

    let file_id = upload(&app, &cookie, "any.txt", None).await;

    // Workspace-wide hold — no target_id.
    let r = place_hold(&app, &cookie, &ws, "workspace", None).await;
    assert_eq!(r.status(), StatusCode::CREATED);

    assert_eq!(trash(&app, &cookie, &file_id).await, StatusCode::CONFLICT);
    assert_eq!(
        purge(&app, &cookie, &file_id).await.status(),
        StatusCode::CONFLICT
    );
}

#[tokio::test]
async fn absurd_min_age_days_is_rejected() {
    let (state, db) = fixture().await;
    let app = router(state);
    let cookie = sign_in(&app, "admin", "hunter2").await;
    let ws = personal_ws(&db, "admin").await;

    // A huge min_age_days would later panic `now - Duration::days(...)` on every
    // purge check; the policy setter must reject it up front.
    let r = app
        .clone()
        .oneshot(auth_req(
            "POST",
            "/api/retention",
            &cookie,
            Some("application/json"),
            Body::from(format!(
                r#"{{"workspace_id":"{ws}","min_age_days":9223372036854775807}}"#
            )),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn retention_blocks_purge_but_allows_trash() {
    let (state, db) = fixture().await;
    let app = router(state);
    let cookie = sign_in(&app, "admin", "hunter2").await;
    let ws = personal_ws(&db, "admin").await;

    let file_id = upload(&app, &cookie, "recent.txt", None).await;

    // 30-day min-age retention; the freshly-committed version is in-window.
    let r = app
        .clone()
        .oneshot(auth_req(
            "POST",
            "/api/retention",
            &cookie,
            Some("application/json"),
            Body::from(format!(r#"{{"workspace_id":"{ws}","min_age_days":30}}"#)),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::CREATED);

    // Purge is blocked by retention...
    let pr = purge(&app, &cookie, &file_id).await;
    assert_eq!(pr.status(), StatusCode::CONFLICT);
    assert_eq!(json_body(pr).await["error"], "under retention");

    // ...but trash (tombstone) is still allowed.
    assert_eq!(trash(&app, &cookie, &file_id).await, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn hold_and_retention_actions_emit_audit_rows() {
    let (state, db) = fixture().await;
    let app = router(state);
    let cookie = sign_in(&app, "admin", "hunter2").await;
    let ws = personal_ws(&db, "admin").await;
    let file_id = upload(&app, &cookie, "audited.txt", None).await;

    let r = place_hold(&app, &cookie, &ws, "file", Some(&file_id)).await;
    let hold_id = json_body(r).await["id"].as_str().unwrap().to_string();

    let r = app
        .clone()
        .oneshot(auth_req(
            "POST",
            "/api/retention",
            &cookie,
            Some("application/json"),
            Body::from(format!(r#"{{"workspace_id":"{ws}","min_versions":3}}"#)),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::CREATED);

    let r = app
        .clone()
        .oneshot(auth_req(
            "DELETE",
            &format!("/api/holds/{hold_id}"),
            &cookie,
            None,
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);

    assert!(wait_for_audit(&db, "hold.placed").await, "hold.placed");
    assert!(wait_for_audit(&db, "retention.set").await, "retention.set");
    assert!(wait_for_audit(&db, "hold.released").await, "hold.released");
}

#[tokio::test]
async fn non_admin_cannot_place_or_list_holds() {
    let (state, db) = fixture().await;
    add_user(&db, "member", false).await;
    let app = router(state);
    let ws = personal_ws(&db, "admin").await;

    let cookie = sign_in(&app, "member", "hunter2password").await;

    // Non-admin, non-owner → 403 on place, list, and retention.
    let r = place_hold(&app, &cookie, &ws, "workspace", None).await;
    assert_eq!(r.status(), StatusCode::FORBIDDEN);

    let r = app
        .clone()
        .oneshot(auth_req(
            "GET",
            &format!("/api/holds?workspace_id={ws}"),
            &cookie,
            None,
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::FORBIDDEN);

    let r = app
        .clone()
        .oneshot(auth_req(
            "POST",
            "/api/retention",
            &cookie,
            Some("application/json"),
            Body::from(format!(r#"{{"workspace_id":"{ws}","min_age_days":10}}"#)),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::FORBIDDEN);
}

// ─── Multipart helper ────────────────────────────────────────────────────

enum MultipartField<'a> {
    Text(&'a str, &'a str),
    File(&'a str, &'a str, &'a str, &'a [u8]),
}

fn build_multipart(boundary: &str, fields: &[MultipartField<'_>]) -> Bytes {
    let mut out: Vec<u8> = Vec::new();
    for f in fields {
        out.extend_from_slice(b"--");
        out.extend_from_slice(boundary.as_bytes());
        out.extend_from_slice(b"\r\n");
        match f {
            MultipartField::Text(name, value) => {
                out.extend_from_slice(
                    format!("Content-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n")
                        .as_bytes(),
                );
            }
            MultipartField::File(name, filename, content_type, bytes) => {
                out.extend_from_slice(
                    format!(
                        "Content-Disposition: form-data; name=\"{name}\"; filename=\"{filename}\"\r\n\
                         Content-Type: {content_type}\r\n\r\n"
                    )
                    .as_bytes(),
                );
                out.extend_from_slice(bytes);
                out.extend_from_slice(b"\r\n");
            }
        }
    }
    out.extend_from_slice(b"--");
    out.extend_from_slice(boundary.as_bytes());
    out.extend_from_slice(b"--\r\n");
    Bytes::from(out)
}
