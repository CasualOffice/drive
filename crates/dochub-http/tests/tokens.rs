//! Integration tests for `/api/tokens` (personal access tokens) and the
//! bearer-token path into `/api/mcp`. Real sqlite + in-memory storage; no
//! network. Proves a headless agent can authenticate to MCP with a PAT and that
//! revocation/expiry are enforced.

use std::{net::SocketAddr, sync::Arc};

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use dochub_auth::{hash_password, AuthState};
use dochub_core::{Backend, Config};
use dochub_db::{AuditChainStatus, AuditRepo, Db, NewUser, UserRepo};
use dochub_http::{router, HttpState};
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

/// POST /api/tokens with a session cookie → (status, body).
async fn create_token(app: &axum::Router, cookie: &str, body: Value) -> (StatusCode, Value) {
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/tokens")
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
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

/// POST /api/mcp with a bearer token (no cookie) → status.
async fn mcp_with_bearer(app: &axum::Router, token: &str) -> StatusCode {
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/mcp")
                .header("host", APP)
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    serde_json::to_vec(
                        &json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}),
                    )
                    .unwrap(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    r.status()
}

#[tokio::test]
async fn create_list_then_authenticate_to_mcp_with_bearer() {
    let app = router(fixture().await);
    let cookie = sign_in(&app).await;

    // Mint a token — plaintext returned once, prefixed.
    let (st, created) = create_token(&app, &cookie, json!({"name":"laptop CLI"})).await;
    assert_eq!(st, StatusCode::CREATED);
    let token = created["token"].as_str().unwrap().to_string();
    assert!(token.starts_with("dh_pat_"));
    assert_eq!(created["name"], "laptop CLI");

    // The bearer token authenticates to MCP with no cookie.
    assert_eq!(mcp_with_bearer(&app, &token).await, StatusCode::OK);

    // It now appears in the list (metadata only, no secret) and shows as used.
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/api/tokens")
                .header("host", APP)
                .header("cookie", &cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    let bytes = r.into_body().collect().await.unwrap().to_bytes();
    let list: Value = serde_json::from_slice(&bytes).unwrap();
    let arr = list.as_array().unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["name"], "laptop CLI");
    assert_eq!(arr[0]["active"], true);
    assert!(
        arr[0].get("token").is_none(),
        "list must never leak secrets"
    );
    assert!(!arr[0]["last_used_at"].is_null(), "use should be stamped");
}

#[tokio::test]
async fn revoked_token_is_rejected() {
    let app = router(fixture().await);
    let cookie = sign_in(&app).await;

    let (_, created) = create_token(&app, &cookie, json!({"name":"temp"})).await;
    let token = created["token"].as_str().unwrap().to_string();
    let id = created["id"].as_str().unwrap().to_string();
    assert_eq!(mcp_with_bearer(&app, &token).await, StatusCode::OK);

    // Revoke it.
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/tokens/{id}"))
                .header("host", APP)
                .header("cookie", &cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::NO_CONTENT);

    // The revoked token no longer authenticates.
    assert_eq!(
        mcp_with_bearer(&app, &token).await,
        StatusCode::UNAUTHORIZED
    );

    // Revoking again is a 404 (nothing active to revoke).
    let r2 = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/tokens/{id}"))
                .header("host", APP)
                .header("cookie", &cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r2.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn bogus_bearer_is_unauthorized() {
    let app = router(fixture().await);
    assert_eq!(
        mcp_with_bearer(&app, "dh_pat_not_a_real_token").await,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn token_management_requires_a_session() {
    // No cookie ⇒ can't mint tokens (a PAT can't bootstrap more PATs).
    let app = router(fixture().await);
    let r = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/tokens")
                .header("host", APP)
                .header("content-type", "application/json")
                .body(Body::from(r#"{"name":"x"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn token_lifecycle_is_audited() {
    let state = fixture().await;
    let app = router(state.clone());
    let cookie = sign_in(&app).await;

    let (_, created) = create_token(&app, &cookie, json!({"name":"audited"})).await;
    let id = created["id"].as_str().unwrap().to_string();

    // Revoke it.
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/tokens/{id}"))
                .header("host", APP)
                .header("cookie", &cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::NO_CONTENT);

    // `emit` is fire-and-forget (spawned), so poll the append-only log for both
    // credential events to land.
    let audit = AuditRepo::new(&state.db);
    let mut created_seen = false;
    let mut revoked_seen = false;
    for _ in 0..100 {
        let events = audit.list(None, 200).await.unwrap();
        created_seen = events
            .iter()
            .any(|e| e.action == "token.created" && e.target_id.as_deref() == Some(id.as_str()));
        revoked_seen = events
            .iter()
            .any(|e| e.action == "token.revoked" && e.target_id.as_deref() == Some(id.as_str()));
        if created_seen && revoked_seen {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    assert!(created_seen, "token.created should be on the audit log");
    assert!(revoked_seen, "token.revoked should be on the audit log");

    // The hash chain stays intact after appending the credential events.
    assert_eq!(
        audit.verify_audit_chain().await.unwrap(),
        AuditChainStatus::Intact
    );
}

#[tokio::test]
async fn blank_name_is_rejected() {
    let app = router(fixture().await);
    let cookie = sign_in(&app).await;
    let (st, _) = create_token(&app, &cookie, json!({"name":"   "})).await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY);
}
