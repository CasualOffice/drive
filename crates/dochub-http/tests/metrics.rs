//! Integration test for `GET /metrics`. Mounts the same `access_log`
//! middleware the binary does, so the counters reflect real served traffic.

use std::{net::SocketAddr, sync::Arc};

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use dochub_auth::AuthState;
use dochub_core::{Backend, Config};
use dochub_db::Db;
use dochub_http::{access_log, router, HttpState};
use dochub_storage::Storage;
use dochub_wopi::WopiState;
use http_body_util::BodyExt;
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

async fn get(app: &axum::Router, uri: &str) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::builder()
                .uri(uri)
                .header("host", APP)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
}

#[tokio::test]
async fn metrics_reflects_served_traffic() {
    let app = router(fixture().await).layer(axum::middleware::from_fn(access_log));

    // A couple of served requests: a 2xx (healthz) and a 4xx (unauth /api/me).
    assert_eq!(get(&app, "/healthz").await.status(), StatusCode::OK);
    assert_eq!(
        get(&app, "/api/me").await.status(),
        StatusCode::UNAUTHORIZED
    );

    let resp = get(&app, "/metrics").await;
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(
        resp.headers()
            .get(axum::http::header::CONTENT_TYPE)
            .unwrap()
            .to_str()
            .unwrap(),
        "text/plain; version=0.0.4"
    );
    let body = resp.into_body().collect().await.unwrap().to_bytes();
    let text = String::from_utf8(body.to_vec()).unwrap();

    // The exposition carries the expected series, and the classes we generated
    // are counted (>= 1 each; other tests don't share this binary's globals).
    assert!(text.contains("dochub_http_requests_total{class=\"2xx\"}"));
    assert!(text.contains("dochub_uptime_seconds"));
    let count = |series: &str| -> u64 {
        text.lines()
            .find(|l| l.starts_with(series))
            .and_then(|l| l.rsplit(' ').next())
            .and_then(|n| n.parse().ok())
            .unwrap_or(0)
    };
    assert!(
        count("dochub_http_requests_total{class=\"2xx\"}") >= 1,
        "healthz should have counted as a 2xx:\n{text}"
    );
    assert!(
        count("dochub_http_requests_total{class=\"4xx\"}") >= 1,
        "unauth /api/me should have counted as a 4xx:\n{text}"
    );
}
