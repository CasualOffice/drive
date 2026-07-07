//! Integration tests for /api/auth/oidc/* — pipeline §1.7 / Phase 3 §12.
//!
//! We don't run against a real IdP (Authentik in a container is the
//! Phase 3 follow-up). v0.3 ships with synchronous contract tests:
//! - `metadata` shape with and without OIDC configured.
//! - `login` 404s when OIDC isn't configured.
//! - `callback` rejects malformed states (no `code`, no `state`).
//! - `sign-in` route returns 404 when `allow_password_auth=false`.

use std::{net::SocketAddr, sync::Arc};

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use dochub_auth::{hash_password, AuthState};
use dochub_core::{Backend, Config, OidcConfig};
use dochub_db::{Db, NewUser, UserRepo};
use dochub_http::{router, HttpState};
use dochub_storage::Storage;
use dochub_wopi::WopiState;
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;
use url::Url;

const APP: &str = "drive.test";
const UCN: &str = "usercontent-drive.test";

async fn fixture(oidc: Option<OidcConfig>, allow_password_auth: bool) -> HttpState {
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
        oidc,
        allow_password_auth,
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
        master_kek_next: None,
    };
    let auth = AuthState::new(db.clone(), false, time::Duration::hours(1))
        .with_password_auth(allow_password_auth);
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

fn fake_oidc() -> OidcConfig {
    OidcConfig {
        issuer: Url::parse("https://idp.test").unwrap(),
        client_id: "casual-drive".into(),
        client_secret: "shh".into(),
        redirect_url: Url::parse("https://drive.test/api/auth/oidc/callback").unwrap(),
        scopes: vec!["openid".into(), "email".into(), "profile".into()],
        admin_group: None,
        auto_create_users: true,
        provider_label: "Authentik".into(),
        provider_id: "test-provider".into(),
    }
}

async fn get(app: &axum::Router, uri: &str) -> (StatusCode, Value) {
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(uri)
                .header("host", APP)
                .body(Body::empty())
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
async fn metadata_disabled_when_oidc_unset() {
    let app = router(fixture(None, true).await);
    let (status, body) = get(&app, "/api/auth/oidc/metadata").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["enabled"], false);
    assert!(body.get("provider_label").is_none());
    assert_eq!(body["allow_password_auth"], true);
}

#[tokio::test]
async fn metadata_enabled_with_label_when_configured() {
    let app = router(fixture(Some(fake_oidc()), true).await);
    let (status, body) = get(&app, "/api/auth/oidc/metadata").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["enabled"], true);
    assert_eq!(body["provider_label"], "Authentik");
}

#[tokio::test]
async fn metadata_reflects_password_auth_gate() {
    let app = router(fixture(Some(fake_oidc()), false).await);
    let (_, body) = get(&app, "/api/auth/oidc/metadata").await;
    assert_eq!(body["allow_password_auth"], false);
}

#[tokio::test]
async fn login_404s_when_oidc_disabled() {
    let app = router(fixture(None, true).await);
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/auth/oidc/login")
                .header("host", APP)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn callback_400s_when_state_missing() {
    let app = router(fixture(Some(fake_oidc()), true).await);
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/auth/oidc/callback?code=abc")
                .header("host", APP)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn callback_400s_when_code_missing() {
    let app = router(fixture(Some(fake_oidc()), true).await);
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/auth/oidc/callback?state=abc")
                .header("host", APP)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn password_sign_in_404s_when_password_auth_disabled() {
    let app = router(fixture(Some(fake_oidc()), false).await);
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
    assert_eq!(r.status(), StatusCode::NOT_FOUND);
}
