//! Integration tests for the file + folder REST API. All endpoints require
//! a valid session cookie obtained via `/api/auth/sign-in`.

use std::{net::SocketAddr, sync::Arc};

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use bytes::Bytes;
use dochub_auth::{hash_password, AuthState};
use dochub_core::{Backend, Config};
use dochub_db::{
    Db, FileRepo, FileStatus, FileVersionsRepo, NewFile, NewUser, UserRepo, WorkspaceKind,
    WorkspaceRepo,
};
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

/// Sign in as admin, return the session cookie value (full `Cookie:` header).
async fn sign_in(app: &axum::Router) -> String {
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/sign-in")
                .header("host", APP)
                .header("content-type", "application/json")
                .body(Body::from(r#"{"username":"admin","password":"hunter2"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    let set_cookie = r
        .headers()
        .get("set-cookie")
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    // Set-Cookie header looks like "dh_sid=...; Path=/; HttpOnly; ...".
    // Strip everything after the first `;` to get the cookie value.
    let pair = set_cookie.split(';').next().unwrap();
    pair.to_string()
}

fn auth_req(
    method: &str,
    path: &str,
    cookie: &str,
    content_type: Option<&str>,
    body: Body,
) -> Request<Body> {
    let mut b = Request::builder()
        .method(method)
        .uri(path)
        .header("host", APP)
        .header("cookie", cookie);
    if let Some(ct) = content_type {
        b = b.header("content-type", ct);
    }
    b.body(body).unwrap()
}

async fn json_body(r: axum::http::Response<Body>) -> Value {
    let bytes = r.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn list_root_requires_auth() {
    let app = router(fixture().await);
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/folders/root/children")
                .header("host", APP)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn list_root_is_empty_for_fresh_admin() {
    let app = router(fixture().await);
    let cookie = sign_in(&app).await;
    let r = app
        .clone()
        .oneshot(auth_req(
            "GET",
            "/api/folders/root/children",
            &cookie,
            None,
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    let body = json_body(r).await;
    assert_eq!(body["folders"].as_array().unwrap().len(), 0);
    assert_eq!(body["files"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn create_folder_then_list_root_shows_it() {
    let app = router(fixture().await);
    let cookie = sign_in(&app).await;
    let r = app
        .clone()
        .oneshot(auth_req(
            "POST",
            "/api/folders",
            &cookie,
            Some("application/json"),
            Body::from(r#"{"name":"Reports"}"#),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    let created = json_body(r).await;
    assert_eq!(created["name"], "Reports");
    let id = created["id"].as_str().unwrap().to_string();
    assert!(!id.is_empty());

    let r = app
        .clone()
        .oneshot(auth_req(
            "GET",
            "/api/folders/root/children",
            &cookie,
            None,
            Body::empty(),
        ))
        .await
        .unwrap();
    let listed = json_body(r).await;
    assert_eq!(listed["folders"].as_array().unwrap().len(), 1);
    assert_eq!(listed["folders"][0]["id"], id);
}

#[tokio::test]
async fn create_folder_rejects_empty_name() {
    let app = router(fixture().await);
    let cookie = sign_in(&app).await;
    let r = app
        .clone()
        .oneshot(auth_req(
            "POST",
            "/api/folders",
            &cookie,
            Some("application/json"),
            Body::from(r#"{"name":"   "}"#),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn upload_file_then_list_root_shows_it() {
    let app = router(fixture().await);
    let cookie = sign_in(&app).await;

    let boundary = "----testboundary";
    let body = build_multipart(
        boundary,
        &[
            MultipartField::Text("parent_id", ""),
            MultipartField::File("file", "hello.txt", "text/plain", b"hello world"),
        ],
    );
    let r = app
        .clone()
        .oneshot(auth_req(
            "POST",
            "/api/files",
            &cookie,
            Some(&format!("multipart/form-data; boundary={boundary}")),
            Body::from(body),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    let created = json_body(r).await;
    assert_eq!(created["name"], "hello.txt");
    assert_eq!(created["size"], 11);
    let id = created["id"].as_str().unwrap().to_string();

    let r = app
        .clone()
        .oneshot(auth_req(
            "GET",
            "/api/folders/root/children",
            &cookie,
            None,
            Body::empty(),
        ))
        .await
        .unwrap();
    let listed = json_body(r).await;
    assert_eq!(listed["files"].as_array().unwrap().len(), 1);
    assert_eq!(listed["files"][0]["id"], id);
    assert_eq!(listed["files"][0]["name"], "hello.txt");
}

#[tokio::test]
async fn get_file_meta_returns_the_dto_after_upload() {
    // `GET /api/files/{id}` — used by Drive's SPA when it lands on
    // `/file/<id>` cold (refresh / shared URL / bookmark) without an
    // in-memory FileDto from the file list.
    let app = router(fixture().await);
    let cookie = sign_in(&app).await;

    let boundary = "----metaboundary";
    let body = build_multipart(
        boundary,
        &[
            MultipartField::Text("parent_id", ""),
            MultipartField::File("file", "meta.txt", "text/plain", b"meta-payload"),
        ],
    );
    let r = app
        .clone()
        .oneshot(auth_req(
            "POST",
            "/api/files",
            &cookie,
            Some(&format!("multipart/form-data; boundary={boundary}")),
            Body::from(body),
        ))
        .await
        .unwrap();
    let created = json_body(r).await;
    let id = created["id"].as_str().unwrap().to_string();

    // Fetch the metadata by id.
    let r = app
        .clone()
        .oneshot(auth_req(
            "GET",
            &format!("/api/files/{id}"),
            &cookie,
            None,
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    let meta = json_body(r).await;
    assert_eq!(meta["id"], id);
    assert_eq!(meta["name"], "meta.txt");
    assert_eq!(meta["size"], 12);
    assert_eq!(meta["content_type"], "text/plain");
}

#[tokio::test]
async fn get_file_meta_404s_for_unknown_id() {
    let app = router(fixture().await);
    let cookie = sign_in(&app).await;
    let r = app
        .clone()
        .oneshot(auth_req(
            "GET",
            "/api/files/does-not-exist",
            &cookie,
            None,
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn get_file_meta_requires_auth() {
    let app = router(fixture().await);
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/files/any-id")
                .header("host", APP)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn upload_rejects_forbidden_extension() {
    let app = router(fixture().await);
    let cookie = sign_in(&app).await;

    for name in ["malware.exe", "install.sh", "auto.bat", "setup.tar.gz.cmd"] {
        let boundary = "----testboundary-blk";
        let body = build_multipart(
            boundary,
            &[MultipartField::File(
                "file",
                name,
                "application/octet-stream",
                b"junk",
            )],
        );
        let r = app
            .clone()
            .oneshot(auth_req(
                "POST",
                "/api/files",
                &cookie,
                Some(&format!("multipart/form-data; boundary={boundary}")),
                Body::from(body),
            ))
            .await
            .unwrap();
        assert_eq!(
            r.status(),
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "{name} should be 415"
        );
        let body = json_body(r).await;
        assert_eq!(body["error"], "file type not allowed");
        let ext = body["extension"].as_str().unwrap();
        assert!(["exe", "sh", "bat", "cmd"].contains(&ext));
    }
}

/// A minimal but valid ZIP (empty archive: an End-Of-Central-Directory record).
/// Enough to satisfy the `PK` magic sniff that all OOXML kinds share.
const EMPTY_ZIP: &[u8] = &[
    0x50, 0x4B, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
];

#[tokio::test]
async fn upload_accepts_xlsm_but_rejects_off_allowlist_macro_formats() {
    // The authoritative documents-only allowlist (CLAUDE.md) includes `xlsm`
    // (opaque, never auto-opened) but NOT `docm` / `pptm`. `xlsm` still has to
    // pass the OOXML magic sniff — a real ZIP container, not arbitrary bytes.
    let app = router(fixture().await);
    let cookie = sign_in(&app).await;

    // xlsm with a valid ZIP body → accepted, stored with the macro-Excel mime.
    let boundary = "----testboundary-xlsm";
    let body = build_multipart(
        boundary,
        &[MultipartField::File(
            "file",
            "sheet.xlsm",
            "application/octet-stream",
            EMPTY_ZIP,
        )],
    );
    let r = app
        .clone()
        .oneshot(auth_req(
            "POST",
            "/api/files",
            &cookie,
            Some(&format!("multipart/form-data; boundary={boundary}")),
            Body::from(body),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK, "xlsm should upload OK");
    assert_eq!(
        json_body(r).await["content_type"],
        "application/vnd.ms-excel.sheet.macroEnabled.12"
    );

    // docm / pptm are not on the allowlist → 415 regardless of content.
    for name in ["doc.docm", "deck.pptm"] {
        let boundary = "----testboundary-macro";
        let body = build_multipart(
            boundary,
            &[MultipartField::File(
                "file",
                name,
                "application/octet-stream",
                EMPTY_ZIP,
            )],
        );
        let r = app
            .clone()
            .oneshot(auth_req(
                "POST",
                "/api/files",
                &cookie,
                Some(&format!("multipart/form-data; boundary={boundary}")),
                Body::from(body),
            ))
            .await
            .unwrap();
        assert_eq!(
            r.status(),
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "{name} should be rejected as off-allowlist"
        );
        assert_eq!(json_body(r).await["error"], "file type not allowed");
    }
}

#[tokio::test]
async fn upload_rejects_when_over_quota() {
    use dochub_db::UserRepo;
    let state = fixture().await;
    let user = UserRepo::new(&state.db)
        .find_by_username("admin")
        .await
        .unwrap();
    UserRepo::new(&state.db)
        .set_quota(&user.id, Some(100))
        .await
        .unwrap();
    let app = router(state);
    let cookie = sign_in(&app).await;

    let boundary = "----testboundary-quota";
    let payload = vec![b'x'; 200];
    let body = build_multipart(
        boundary,
        &[MultipartField::File(
            "file",
            "big.txt",
            "text/plain",
            &payload,
        )],
    );
    let r = app
        .clone()
        .oneshot(auth_req(
            "POST",
            "/api/files",
            &cookie,
            Some(&format!("multipart/form-data; boundary={boundary}")),
            Body::from(body),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::PAYLOAD_TOO_LARGE);
    let body = json_body(r).await;
    assert_eq!(body["error"], "quota exceeded");
    assert_eq!(body["quota"], 100);
}

#[tokio::test]
async fn upload_quota_is_scoped_per_workspace_not_per_user() {
    // Quota is per-workspace (§12): the SAME user's usage in one workspace
    // must not count against their upload to a DIFFERENT workspace, and the
    // proxy path must accumulate the whole workspace's usage (not just this
    // uploader's files) — the same accounting the direct-upload path uses.
    // Under the old per-user accounting the second upload here would be
    // refused.
    let state = fixture().await;
    let user = UserRepo::new(&state.db)
        .find_by_username("admin")
        .await
        .unwrap();
    UserRepo::new(&state.db)
        .set_quota(&user.id, Some(150))
        .await
        .unwrap();
    // A second workspace the admin owns.
    let ws2 = WorkspaceRepo::new(&state.db)
        .insert("Team", WorkspaceKind::Team, &user.id)
        .await
        .unwrap();

    let app = router(state);
    let cookie = sign_in(&app).await;
    let payload = vec![b'x'; 100];
    let boundary = "----wsquota";

    let upload_to = |ws: Option<&str>| {
        let mut fields = vec![
            MultipartField::Text("parent_id", ""),
            MultipartField::File("file", "a.txt", "text/plain", &payload),
        ];
        if let Some(id) = ws {
            fields.insert(1, MultipartField::Text("workspace_id", id));
        }
        let body = build_multipart(boundary, &fields);
        app.clone().oneshot(auth_req(
            "POST",
            "/api/files",
            &cookie,
            Some(&format!("multipart/form-data; boundary={boundary}")),
            Body::from(body),
        ))
    };

    // 100 of 150 bytes in the default (personal) workspace.
    assert!(
        upload_to(None).await.unwrap().status().is_success(),
        "personal-workspace upload within quota"
    );

    // Global usage is now 100, but workspace 2 is empty. Per-user accounting
    // (100 + 100 > 150) would reject; per-workspace accepts.
    assert!(
        upload_to(Some(&ws2.id))
            .await
            .unwrap()
            .status()
            .is_success(),
        "an empty second workspace must accept the upload under per-workspace quota"
    );

    // The workspace's OWN total is still capped: ws2 now holds 100, +100 > 150.
    assert_eq!(
        upload_to(Some(&ws2.id)).await.unwrap().status(),
        StatusCode::PAYLOAD_TOO_LARGE,
        "the per-workspace cap still applies within a workspace"
    );
}

#[tokio::test]
async fn trashed_files_still_count_against_quota() {
    // Review finding #13: trashing a file does NOT erase its bytes (trash and
    // purge are both retain-only until Phase 4). So its bytes must keep counting
    // against the quota — otherwise a user could trash-and-reupload without bound
    // and grow real disk usage past the cap. Under the old accounting (which
    // excluded `trashed_at IS NOT NULL` rows) the second upload below succeeded.
    use dochub_db::UserRepo;
    let state = fixture().await;
    let user = UserRepo::new(&state.db)
        .find_by_username("admin")
        .await
        .unwrap();
    UserRepo::new(&state.db)
        .set_quota(&user.id, Some(150))
        .await
        .unwrap();
    let app = router(state);
    let cookie = sign_in(&app).await;

    let boundary = "----trashquota";
    let upload = |name: &'static str, n: usize| {
        let payload = vec![b'x'; n];
        let body = build_multipart(
            boundary,
            &[MultipartField::File("file", name, "text/plain", &payload)],
        );
        app.clone().oneshot(auth_req(
            "POST",
            "/api/files",
            &cookie,
            Some(&format!("multipart/form-data; boundary={boundary}")),
            Body::from(body),
        ))
    };

    // 100 of 150 bytes used.
    let r = upload("a.txt", 100).await.unwrap();
    assert_eq!(r.status(), StatusCode::OK, "first upload within quota");
    let file_id = json_body(r).await["id"].as_str().unwrap().to_string();

    // Trash it — bytes are retained on disk (retain-only), so usage stays 100.
    let r = app
        .clone()
        .oneshot(auth_req(
            "POST",
            &format!("/api/files/{file_id}/trash"),
            &cookie,
            None,
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::NO_CONTENT);

    // A second 100-byte upload would put REAL usage at 200 > 150 — rejected.
    // The trash-and-reupload leak is closed.
    let r = upload("b.txt", 100).await.unwrap();
    assert_eq!(
        r.status(),
        StatusCode::PAYLOAD_TOO_LARGE,
        "trashed bytes still count, so re-upload past the cap is refused"
    );
    assert_eq!(json_body(r).await["error"], "quota exceeded");

    // But accounting is exact, not a blanket block: 40 more bytes (100+40 ≤ 150)
    // still fits.
    let r = upload("c.txt", 40).await.unwrap();
    assert_eq!(
        r.status(),
        StatusCode::OK,
        "an upload that fits under the real total still succeeds"
    );
}

#[tokio::test]
async fn upload_throttles_burst_with_429_and_retry_after() {
    use dochub_http::{RateLimitConfig, RateLimiter};
    use std::sync::Arc;
    let mut state = fixture().await;
    state.upload_limiter = Arc::new(RateLimiter::new(RateLimitConfig {
        capacity: 2.0,
        refill_per_sec: 0.01,
    }));
    let app = router(state);
    let cookie = sign_in(&app).await;

    async fn upload(app: &axum::Router, cookie: &str, idx: usize) -> axum::http::Response<Body> {
        let boundary = format!("----rate{idx}");
        let body = build_multipart(
            &boundary,
            &[MultipartField::File("file", "a.txt", "text/plain", b"hi")],
        );
        app.clone()
            .oneshot(auth_req(
                "POST",
                "/api/files",
                cookie,
                Some(&format!("multipart/form-data; boundary={boundary}")),
                Body::from(body),
            ))
            .await
            .unwrap()
    }

    assert_eq!(upload(&app, &cookie, 0).await.status(), StatusCode::OK);
    assert_eq!(upload(&app, &cookie, 1).await.status(), StatusCode::OK);
    let r = upload(&app, &cookie, 2).await;
    assert_eq!(r.status(), StatusCode::TOO_MANY_REQUESTS);
    assert!(r.headers().get("retry-after").is_some());
    let body = json_body(r).await;
    assert_eq!(body["error"], "rate limited");
    assert!(body["retry_after_seconds"].as_u64().unwrap() >= 1);
}

#[tokio::test]
async fn upload_rejects_executable_disguised_as_text() {
    // A .txt name carrying Windows PE bytes ("MZ\x90..."). The extension is
    // allowlisted, but text formats must be valid UTF-8 — the 0x90 byte isn't,
    // so the magic-byte sniff catches the lie as a content mismatch.
    let app = router(fixture().await);
    let cookie = sign_in(&app).await;
    let mut payload = Vec::with_capacity(128);
    payload.extend_from_slice(b"MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00");
    payload.extend_from_slice(&[0u8; 100]);

    let boundary = "----testboundary-pe";
    let body = build_multipart(
        boundary,
        &[MultipartField::File(
            "file",
            "notes.txt",
            "text/plain",
            &payload,
        )],
    );
    let r = app
        .clone()
        .oneshot(auth_req(
            "POST",
            "/api/files",
            &cookie,
            Some(&format!("multipart/form-data; boundary={boundary}")),
            Body::from(body),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
    assert_eq!(
        json_body(r).await["error"],
        "file content does not match its extension"
    );
}

#[tokio::test]
async fn upload_rejects_off_allowlist_extension_even_with_known_magic() {
    // A .bin carrying real PNG magic. `bin` isn't a document type, so the
    // allowlist rejects it at the extension gate regardless of content — this
    // is a document registry, not general file storage.
    let app = router(fixture().await);
    let cookie = sign_in(&app).await;
    let mut payload = Vec::with_capacity(64);
    payload.extend_from_slice(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    payload.extend_from_slice(&[0u8; 56]);

    let boundary = "----testboundary-png";
    let body = build_multipart(
        boundary,
        &[MultipartField::File(
            "file",
            "photo.bin",
            "application/octet-stream",
            &payload,
        )],
    );
    let r = app
        .clone()
        .oneshot(auth_req(
            "POST",
            "/api/files",
            &cookie,
            Some(&format!("multipart/form-data; boundary={boundary}")),
            Body::from(body),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
    let body = json_body(r).await;
    assert_eq!(body["error"], "file type not allowed");
    assert_eq!(body["extension"], "bin");
}

#[tokio::test]
async fn upload_stores_authoritative_content_type_over_client_claim() {
    // The client lies with "application/octet-stream" for a real .docx (valid
    // OOXML ZIP). The server stores the canonical, sniffed document mime — the
    // one signal the uploader can't forge — not the client header.
    let app = router(fixture().await);
    let cookie = sign_in(&app).await;

    let boundary = "----testboundary-docx";
    let body = build_multipart(
        boundary,
        &[MultipartField::File(
            "file",
            "report.docx",
            "application/octet-stream",
            EMPTY_ZIP,
        )],
    );
    let r = app
        .clone()
        .oneshot(auth_req(
            "POST",
            "/api/files",
            &cookie,
            Some(&format!("multipart/form-data; boundary={boundary}")),
            Body::from(body),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    assert_eq!(
        json_body(r).await["content_type"],
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
}

#[tokio::test]
async fn rename_then_move_then_trash_then_restore() {
    let app = router(fixture().await);
    let cookie = sign_in(&app).await;

    // Create a folder and upload a file into root.
    let folder = json_body(
        app.clone()
            .oneshot(auth_req(
                "POST",
                "/api/folders",
                &cookie,
                Some("application/json"),
                Body::from(r#"{"name":"Reports"}"#),
            ))
            .await
            .unwrap(),
    )
    .await;
    let folder_id = folder["id"].as_str().unwrap().to_string();

    let boundary = "----b";
    let body = build_multipart(
        boundary,
        &[MultipartField::File("file", "a.txt", "text/plain", b"hi")],
    );
    let file = json_body(
        app.clone()
            .oneshot(auth_req(
                "POST",
                "/api/files",
                &cookie,
                Some(&format!("multipart/form-data; boundary={boundary}")),
                Body::from(body),
            ))
            .await
            .unwrap(),
    )
    .await;
    let file_id = file["id"].as_str().unwrap().to_string();

    // Rename the file.
    let r = app
        .clone()
        .oneshot(auth_req(
            "PATCH",
            &format!("/api/files/{file_id}"),
            &cookie,
            Some("application/json"),
            Body::from(r#"{"name":"a-renamed.txt"}"#),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    assert_eq!(json_body(r).await["name"], "a-renamed.txt");

    // Move into the folder.
    let r = app
        .clone()
        .oneshot(auth_req(
            "PATCH",
            &format!("/api/files/{file_id}"),
            &cookie,
            Some("application/json"),
            Body::from(format!(r#"{{"parent_id":"{folder_id}"}}"#)),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    assert_eq!(json_body(r).await["parent_id"], folder_id);

    // Root no longer lists it.
    let listed = json_body(
        app.clone()
            .oneshot(auth_req(
                "GET",
                "/api/folders/root/children",
                &cookie,
                None,
                Body::empty(),
            ))
            .await
            .unwrap(),
    )
    .await;
    assert!(listed["files"].as_array().unwrap().is_empty());

    // Trash it.
    let r = app
        .clone()
        .oneshot(auth_req(
            "POST",
            &format!("/api/files/{file_id}/trash"),
            &cookie,
            None,
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::NO_CONTENT);

    // Restore puts it back under the folder.
    let r = app
        .clone()
        .oneshot(auth_req(
            "POST",
            &format!("/api/files/{file_id}/restore"),
            &cookie,
            None,
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::NO_CONTENT);
    let inside = json_body(
        app.clone()
            .oneshot(auth_req(
                "GET",
                &format!("/api/folders/{folder_id}"),
                &cookie,
                None,
                Body::empty(),
            ))
            .await
            .unwrap(),
    )
    .await;
    let kids = inside["children"]["files"].as_array().unwrap();
    assert_eq!(kids.len(), 1);
    assert_eq!(kids[0]["id"], file_id);
}

#[tokio::test]
async fn download_streams_decrypted_bytes_from_the_version_chain() {
    // Post-cutover: download no longer 302-redirects to a signed plaintext
    // URL — it decrypts the head version and streams it as an attachment.
    let app = router(fixture().await);
    let cookie = sign_in(&app).await;
    let boundary = "----b";
    let body = build_multipart(
        boundary,
        &[MultipartField::File("file", "x.txt", "text/plain", b"abc")],
    );
    let file = json_body(
        app.clone()
            .oneshot(auth_req(
                "POST",
                "/api/files",
                &cookie,
                Some(&format!("multipart/form-data; boundary={boundary}")),
                Body::from(body),
            ))
            .await
            .unwrap(),
    )
    .await;
    let id = file["id"].as_str().unwrap();
    let r = app
        .clone()
        .oneshot(auth_req(
            "GET",
            &format!("/api/files/{id}/download"),
            &cookie,
            None,
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    let disp = r
        .headers()
        .get("content-disposition")
        .unwrap()
        .to_str()
        .unwrap();
    assert!(disp.starts_with("attachment"), "got disposition {disp}");
    let bytes = r.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(bytes.as_ref(), b"abc");
}

// ─── Version-chain read/write cutover ────────────────────────────────────

/// Upload (a save) commits an immutable version and writes NO plaintext blob;
/// reading the content back serves the committed bytes from the chain.
#[tokio::test]
async fn upload_commits_a_version_and_reads_from_the_chain() {
    let state = fixture().await;
    let app = router(state.clone());
    let cookie = sign_in(&app).await;

    let boundary = "----chain";
    let body = build_multipart(
        boundary,
        &[MultipartField::File(
            "file",
            "doc.txt",
            "text/plain",
            b"hello world",
        )],
    );
    let created = json_body(
        app.clone()
            .oneshot(auth_req(
                "POST",
                "/api/files",
                &cookie,
                Some(&format!("multipart/form-data; boundary={boundary}")),
                Body::from(body),
            ))
            .await
            .unwrap(),
    )
    .await;
    let id = created["id"].as_str().unwrap().to_string();

    // A committed version row exists at seq=1.
    let head = FileVersionsRepo::new(&state.db)
        .head(&id)
        .await
        .unwrap()
        .expect("v1 must be committed on upload");
    assert_eq!(head.seq, 1);

    // No plaintext document blob was written to the backend (spy on storage).
    assert!(
        matches!(
            state.storage.stat(&format!("files/{id}")).await,
            Err(dochub_storage::StorageError::NotFound(_))
        ),
        "no plaintext blob may exist at files/{{id}} after save"
    );

    // Reading the content back serves the committed plaintext, byte-identical.
    let r = app
        .clone()
        .oneshot(auth_req(
            "GET",
            &format!("/api/files/{id}/content"),
            &cookie,
            None,
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    let bytes = r.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(bytes.as_ref(), b"hello world");
}

/// The SDK save path (`PUT /content`) commits a new head version and no
/// plaintext blob; the next read serves the new bytes from the chain.
#[tokio::test]
async fn put_content_save_bumps_the_chain_and_reads_back() {
    let state = fixture().await;
    let app = router(state.clone());
    let cookie = sign_in(&app).await;

    // Seed via upload (seq=1), then save new bytes via the SDK content PUT.
    let boundary = "----put";
    let body = build_multipart(
        boundary,
        &[MultipartField::File(
            "file",
            "note.txt",
            "text/plain",
            b"v1 body",
        )],
    );
    let created = json_body(
        app.clone()
            .oneshot(auth_req(
                "POST",
                "/api/files",
                &cookie,
                Some(&format!("multipart/form-data; boundary={boundary}")),
                Body::from(body),
            ))
            .await
            .unwrap(),
    )
    .await;
    let id = created["id"].as_str().unwrap().to_string();

    let r = app
        .clone()
        .oneshot(auth_req(
            "PUT",
            &format!("/api/files/{id}/content"),
            &cookie,
            Some("application/octet-stream"),
            Body::from("v2 body!!"),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);

    // Head advanced to seq=2, still no plaintext blob.
    let head = FileVersionsRepo::new(&state.db)
        .head(&id)
        .await
        .unwrap()
        .expect("head exists");
    assert_eq!(head.seq, 2);
    assert!(
        matches!(
            state.storage.stat(&format!("files/{id}")).await,
            Err(dochub_storage::StorageError::NotFound(_))
        ),
        "PUT save must not write a plaintext blob"
    );

    // Read serves the latest committed bytes.
    let r = app
        .clone()
        .oneshot(auth_req(
            "GET",
            &format!("/api/files/{id}/content"),
            &cookie,
            None,
            Body::empty(),
        ))
        .await
        .unwrap();
    let bytes = r.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(bytes.as_ref(), b"v2 body!!");
}

/// Optimistic concurrency: a content PUT carrying a stale `If-Match` version
/// (the head moved on since it was read) is refused with 409 instead of
/// silently clobbering the newer committed version. The current version still
/// saves fine.
#[tokio::test]
async fn put_content_rejects_stale_if_match_with_409() {
    let state = fixture().await;
    let app = router(state.clone());
    let cookie = sign_in(&app).await;

    let boundary = "----ifmatch";
    let body = build_multipart(
        boundary,
        &[MultipartField::File(
            "file",
            "note.txt",
            "text/plain",
            b"v1",
        )],
    );
    let created = json_body(
        app.clone()
            .oneshot(auth_req(
                "POST",
                "/api/files",
                &cookie,
                Some(&format!("multipart/form-data; boundary={boundary}")),
                Body::from(body),
            ))
            .await
            .unwrap(),
    )
    .await;
    let id = created["id"].as_str().unwrap().to_string();
    assert_eq!(created["version"], 1);

    let put = |if_match: &str, payload: &'static str| {
        app.clone().oneshot(
            Request::builder()
                .method("PUT")
                .uri(format!("/api/files/{id}/content"))
                .header("host", APP)
                .header("cookie", &cookie)
                .header("content-type", "application/octet-stream")
                .header("if-match", if_match)
                .body(Body::from(payload))
                .unwrap(),
        )
    };

    // Correct base version (1) → saved, head advances to 2.
    assert_eq!(put("1", "v2").await.unwrap().status(), StatusCode::OK);
    // Stale base version (still 1) → 409, no clobber.
    assert_eq!(
        put("1", "v3-stale").await.unwrap().status(),
        StatusCode::CONFLICT
    );
    // Current base version (2) → saved.
    assert_eq!(put("2", "v3").await.unwrap().status(), StatusCode::OK);

    // The stale write never landed: head is 3 (v1 upload, v2, v3), not 4.
    let head = FileVersionsRepo::new(&state.db)
        .head(&id)
        .await
        .unwrap()
        .expect("head exists");
    assert_eq!(head.seq, 3);
}

/// A pre-existing legacy file (a file row + a plaintext blob, no version row)
/// backfills v1 on first read and serves those bytes; a second read reuses the
/// existing v1 with no duplicate backfill.
#[tokio::test]
async fn legacy_file_is_backfilled_once_on_read() {
    let state = fixture().await;
    let app = router(state.clone());
    let cookie = sign_in(&app).await;

    let admin = UserRepo::new(&state.db)
        .find_by_username("admin")
        .await
        .unwrap();
    let ws = WorkspaceRepo::new(&state.db)
        .list_for_user(&admin.id)
        .await
        .unwrap()
        .into_iter()
        .find(|w| matches!(w.kind, WorkspaceKind::Personal))
        .expect("admin has a Personal workspace")
        .id;

    // Insert a file row + a legacy plaintext blob, but NO version row.
    let id = ulid::Ulid::new().to_string();
    FileRepo::new(&state.db)
        .insert(&NewFile {
            id: id.clone(),
            parent_id: None,
            name: "legacy.txt".into(),
            size: 12,
            content_type: Some("text/plain".into()),
            etag: None,
            owner_id: admin.id.clone(),
            workspace_id: ws,
            project_id: None,
            storage_id: None,
            status: FileStatus::Ready,
            expected_size: None,
        })
        .await
        .unwrap();
    state
        .storage
        .put(
            &format!("files/{id}"),
            Bytes::from_static(b"legacy bytes"),
            None,
        )
        .await
        .unwrap();
    assert!(
        FileVersionsRepo::new(&state.db)
            .head(&id)
            .await
            .unwrap()
            .is_none(),
        "precondition: no version row yet"
    );

    // First read backfills v1 and returns the legacy bytes.
    let r = app
        .clone()
        .oneshot(auth_req(
            "GET",
            &format!("/api/files/{id}/content"),
            &cookie,
            None,
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    let bytes = r.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(bytes.as_ref(), b"legacy bytes");

    let head = FileVersionsRepo::new(&state.db)
        .head(&id)
        .await
        .unwrap()
        .expect("backfilled v1");
    assert_eq!(head.seq, 1);
    assert_eq!(head.reason.as_deref(), Some("backfill v1"));

    // Second read reuses v1 — no duplicate backfill.
    let r = app
        .clone()
        .oneshot(auth_req(
            "GET",
            &format!("/api/files/{id}/content"),
            &cookie,
            None,
            Body::empty(),
        ))
        .await
        .unwrap();
    let bytes = r.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(bytes.as_ref(), b"legacy bytes");
    let chain = FileVersionsRepo::new(&state.db)
        .list_chain(&id)
        .await
        .unwrap();
    assert_eq!(
        chain.len(),
        1,
        "second read must not append another version"
    );
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
