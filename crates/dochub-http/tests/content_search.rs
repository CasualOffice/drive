//! Integration tests for `GET /api/search/content` — Phase 3 P3.1 full-text
//! content search over the Tantivy index. Real sqlite + in-memory storage +
//! an in-memory index (no `DOCHUB_INDEX_PATH` set ⇒ per-fixture RAM index).
//!
//! Covers: find-by-content (not name), reindex on new version, removal on
//! trash, cross-workspace isolation, and unauthenticated rejection.

use std::{net::SocketAddr, sync::Arc};

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use dochub_auth::{hash_password, AuthState};
use dochub_core::{Backend, Config};
use dochub_db::{
    Db, FileRepo, JobsRepo, NewFile, NewUser, Registry, UserRepo, WorkspaceDeks, WorkspaceKind,
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

async fn sign_in_as(app: &axum::Router, user: &str) -> String {
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/auth/sign-in")
                .header("host", APP)
                .header("content-type", "application/json")
                .body(Body::from(format!(
                    r#"{{"username":"{user}","password":"hunter2hunter2"}}"#
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

async fn user_id(state: &HttpState, username: &str) -> String {
    UserRepo::new(&state.db)
        .find_by_username(username)
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

/// Insert a file row and commit an encrypted head version carrying `content`.
/// Returns the file id.
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

async fn commit_new_version(state: &HttpState, ws: &str, id: &str, owner: &str, content: &[u8]) {
    let deks = WorkspaceDeks::new(state.db.clone(), state.config.master_kek.clone());
    let registry = Registry::new(state.db.clone(), state.storage.clone(), deks);
    registry
        .commit_version(ws, id, content, owner, "new version")
        .await
        .unwrap();
}

async fn search(app: &axum::Router, cookie: &str, q: &str) -> Value {
    let r = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/search/content?q={q}"))
                .header("host", APP)
                .header("cookie", cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK, "search q={q}");
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
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/search/content?q=anything")
                .header("host", APP)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn finds_by_content_not_name() {
    let state = fixture().await;
    let owner = user_id(&state, "admin").await;
    let ws = personal_ws(&state, &owner).await;
    // Distinctive phrase lives only inside the file body, not the name.
    let hit_id = make_file(
        &state,
        &ws,
        &owner,
        "notes.md",
        b"# Standup\nThe migration to sasquatch-storage completed overnight.",
    )
    .await;
    make_file(
        &state,
        &ws,
        &owner,
        "weather.txt",
        b"unrelated body about weather and lunch plans",
    )
    .await;

    let app = router(state);
    let cookie = sign_in_as(&app, "admin").await;

    // "sasquatch" appears only inside notes.md's *body* (not its name), so a
    // pure content match returns exactly that file.
    let body = search(&app, &cookie, "sasquatch").await;
    assert_eq!(ids(&body), vec![hit_id.clone()]);
    // Snippet highlights the term.
    assert!(body[0]["snippet"].as_str().unwrap().contains("sasquatch"));
    assert_eq!(body[0]["kind"].as_str().unwrap(), "markdown");

    // A phrase in neither body returns nothing.
    let none = search(&app, &cookie, "helicopter").await;
    assert!(none.as_array().unwrap().is_empty());
}

#[tokio::test]
async fn reindex_reflects_new_version() {
    let state = fixture().await;
    let owner = user_id(&state, "admin").await;
    let ws = personal_ws(&state, &owner).await;
    let id = make_file(
        &state,
        &ws,
        &owner,
        "doc.md",
        b"contains the word zebra here",
    )
    .await;

    let app = router(state.clone());
    let cookie = sign_in_as(&app, "admin").await;

    // First pass: old term matches.
    assert_eq!(ids(&search(&app, &cookie, "zebra").await), vec![id.clone()]);

    // New version with different content.
    commit_new_version(&state, &ws, &id, &owner, b"now it mentions giraffe instead").await;

    // Reindex on next search: new term matches, old term no longer does.
    assert_eq!(
        ids(&search(&app, &cookie, "giraffe").await),
        vec![id.clone()]
    );
    assert!(search(&app, &cookie, "zebra")
        .await
        .as_array()
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn trashed_file_leaves_the_index() {
    let state = fixture().await;
    let owner = user_id(&state, "admin").await;
    let ws = personal_ws(&state, &owner).await;
    let id = make_file(&state, &ws, &owner, "doc.md", b"findable pineapple content").await;

    let app = router(state.clone());
    let cookie = sign_in_as(&app, "admin").await;
    assert_eq!(
        ids(&search(&app, &cookie, "pineapple").await),
        vec![id.clone()]
    );

    // Trash it — next search removes it from the index and returns nothing.
    FileRepo::new(&state.db).trash(&id).await.unwrap();
    assert!(search(&app, &cookie, "pineapple")
        .await
        .as_array()
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn workspace_isolation() {
    let state = fixture().await;
    // Second user with their own personal workspace.
    UserRepo::new(&state.db)
        .insert(&NewUser {
            username: "other".into(),
            password_hash: hash_password("hunter2hunter2").unwrap(),
            is_admin: false,
        })
        .await
        .unwrap();

    let admin = user_id(&state, "admin").await;
    let admin_ws = personal_ws(&state, &admin).await;
    let other = user_id(&state, "other").await;
    let other_ws = personal_ws(&state, &other).await;

    // Same distinctive phrase in both workspaces.
    let admin_file = make_file(
        &state,
        &admin_ws,
        &admin,
        "a.md",
        b"shared phrase quokka alpha",
    )
    .await;
    make_file(
        &state,
        &other_ws,
        &other,
        "b.md",
        b"shared phrase quokka beta",
    )
    .await;

    let app = router(state);

    // Admin only ever sees their own workspace's hit.
    let admin_cookie = sign_in_as(&app, "admin").await;
    let admin_hits = search(&app, &admin_cookie, "quokka").await;
    assert_eq!(ids(&admin_hits), vec![admin_file]);

    // Other user sees only theirs.
    let other_cookie = sign_in_as(&app, "other").await;
    let other_hits = search(&app, &other_cookie, "quokka").await;
    assert_eq!(other_hits.as_array().unwrap().len(), 1);
    assert_ne!(
        other_hits[0]["file_id"].as_str().unwrap(),
        admin_hits[0]["file_id"].as_str().unwrap()
    );
}

#[tokio::test]
async fn commit_enqueues_index_job() {
    let state = fixture().await;
    let owner = user_id(&state, "admin").await;
    let ws = personal_ws(&state, &owner).await;

    // A single committed version schedules exactly one index_file job.
    make_file(&state, &ws, &owner, "notes.md", b"content to index").await;
    let queued = JobsRepo::new(&state.db)
        .count_in_state(dochub_db::job_state::QUEUED)
        .await
        .unwrap();
    assert_eq!(queued, 1);
}

#[tokio::test]
async fn worker_indexes_committed_file() {
    let state = fixture().await;
    let owner = user_id(&state, "admin").await;
    let ws = personal_ws(&state, &owner).await;
    // Body-only codeword — only content indexing makes it findable.
    let id = make_file(&state, &ws, &owner, "memo.md", b"the codeword is platypus").await;

    // Drain the queued index_file job through the real handler.
    let worker = dochub_worker::Worker::new(state.db.clone()).register(
        dochub_db::KIND_INDEX_FILE,
        Arc::new(dochub_http::IndexFileHandler::new(state.clone())),
    );
    let step = worker
        .run_once(time::OffsetDateTime::now_utc())
        .await
        .unwrap();
    assert!(
        matches!(step, dochub_worker::Step::Completed(_)),
        "handler should complete the index job: {step:?}"
    );
    assert_eq!(
        JobsRepo::new(&state.db)
            .count_in_state(dochub_db::job_state::DONE)
            .await
            .unwrap(),
        1
    );

    // The worker populated the shared index: the body term is now searchable.
    let app = router(state);
    let cookie = sign_in_as(&app, "admin").await;
    assert_eq!(ids(&search(&app, &cookie, "platypus").await), vec![id]);
}

/// Build a minimal but valid `.docx` (OOXML zip) whose `word/document.xml`
/// carries `paragraphs` as `<w:t>` runs — enough for `dochub_core::extract` to
/// pull the body text.
fn docx_bytes(paragraphs: &[&str]) -> Vec<u8> {
    use std::fmt::Write as _;
    use std::io::{Cursor, Write};
    use zip::write::SimpleFileOptions;

    let mut body = String::new();
    for p in paragraphs {
        write!(body, "<w:p><w:r><w:t>{p}</w:t></w:r></w:p>").unwrap();
    }
    let doc = format!(
        r#"<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{body}</w:body></w:document>"#
    );
    let mut buf = Vec::new();
    {
        let mut w = zip::ZipWriter::new(Cursor::new(&mut buf));
        let opts =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        w.start_file("[Content_Types].xml", opts).unwrap();
        w.write_all(b"<Types/>").unwrap();
        w.start_file("word/document.xml", opts).unwrap();
        w.write_all(doc.as_bytes()).unwrap();
        w.finish().unwrap();
    }
    buf
}

#[tokio::test]
async fn docx_content_is_searchable() {
    let state = fixture().await;
    let owner = user_id(&state, "admin").await;
    let ws = personal_ws(&state, &owner).await;
    // Distinctive phrase lives only inside the docx body, not its name.
    let bytes = docx_bytes(&[
        "The acquisition of Aperture Science closed in Q3.",
        "Synergy targets exceeded plan.",
    ]);
    let id = make_file(&state, &ws, &owner, "Board memo.docx", &bytes).await;

    let app = router(state);
    let cookie = sign_in_as(&app, "admin").await;

    // A term only inside the extracted docx body is found — proves extraction
    // ran, not just title indexing.
    let hits = search(&app, &cookie, "Aperture").await;
    assert_eq!(ids(&hits), vec![id.clone()]);
    assert_eq!(hits[0]["kind"].as_str().unwrap(), "document");
    // A word in neither title nor body does not match.
    assert!(search(&app, &cookie, "helicopter")
        .await
        .as_array()
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn unsupported_format_indexes_title_only() {
    let state = fixture().await;
    let owner = user_id(&state, "admin").await;
    let ws = personal_ws(&state, &owner).await;
    // A pdf: content extraction is a follow-up, so only the title is indexed.
    let id = make_file(
        &state,
        &ws,
        &owner,
        "Quarterly budget.pdf",
        b"%PDF-1.4 binary body",
    )
    .await;

    let app = router(state);
    let cookie = sign_in_as(&app, "admin").await;

    // Title term matches.
    assert_eq!(ids(&search(&app, &cookie, "budget").await), vec![id]);
    // A term only in the (un-extracted) body does not.
    assert!(search(&app, &cookie, "binary")
        .await
        .as_array()
        .unwrap()
        .is_empty());
}
