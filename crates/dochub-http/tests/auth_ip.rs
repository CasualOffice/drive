//! Integration test: auth audit events record the client IP from proxy
//! headers. A failed-login investigation is useless without a source IP, so
//! `auth.sign_in_failed` / `auth.sign_in` must carry the `X-Forwarded-For`
//! hop. Own test binary so the process-global login throttle is isolated.

use std::{net::SocketAddr, sync::Arc};

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use dochub_auth::{hash_password, AuthState};
use dochub_core::{Backend, Config};
use dochub_db::{AuditRepo, Db, NewUser, UserRepo};
use dochub_http::{router, HttpState};
use dochub_storage::Storage;
use dochub_wopi::WopiState;
use tower::ServiceExt;
use url::Url;

const APP: &str = "drive.test";
const UCN: &str = "usercontent-drive.test";
const CLIENT_IP: &str = "203.0.113.7";

async fn fixture() -> HttpState {
    let storage = Storage::memory([1u8; 32]).unwrap();
    let db = Db::connect("sqlite::memory:").await.unwrap();
    UserRepo::new(&db)
        .insert(&NewUser {
            username: "ipuser".into(),
            password_hash: hash_password("correct-horse-battery").unwrap(),
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

async fn sign_in(app: &axum::Router, password: &str) -> StatusCode {
    app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/sign-in")
                .header("host", APP)
                .header("content-type", "application/json")
                // Two hops: the real client then a proxy. We must record the
                // first, not the proxy.
                .header("x-forwarded-for", format!("{CLIENT_IP}, 10.0.0.1"))
                .body(Body::from(format!(
                    r#"{{"username":"ipuser","password":"{password}"}}"#
                )))
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
}

/// The audit insert is fire-and-forget (`tokio::spawn`), so poll briefly for
/// the row rather than assuming it lands synchronously.
async fn latest_ip(db: &Db, action: &str) -> Option<String> {
    for _ in 0..40 {
        let rows = AuditRepo::new(db)
            .list_filtered(&[action], 5)
            .await
            .unwrap();
        if let Some(ev) = rows.into_iter().find(|e| e.action == action) {
            return ev.ip_address;
        }
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }
    None
}

#[tokio::test]
async fn failed_sign_in_records_forwarded_for_client_ip() {
    let state = fixture().await;
    let db = state.db.clone();
    let app = router(state);

    assert_eq!(sign_in(&app, "wrong").await, StatusCode::UNAUTHORIZED);

    assert_eq!(
        latest_ip(&db, "auth.sign_in_failed").await.as_deref(),
        Some(CLIENT_IP),
        "failed sign-in must record the first X-Forwarded-For hop"
    );
}

#[tokio::test]
async fn successful_sign_in_records_forwarded_for_client_ip() {
    let state = fixture().await;
    let db = state.db.clone();
    let app = router(state);

    assert_eq!(sign_in(&app, "correct-horse-battery").await, StatusCode::OK);

    assert_eq!(
        latest_ip(&db, "auth.sign_in").await.as_deref(),
        Some(CLIENT_IP),
        "successful sign-in must record the first X-Forwarded-For hop"
    );
}
