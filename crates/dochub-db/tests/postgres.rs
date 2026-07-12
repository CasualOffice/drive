//! Postgres portability smoke test.
//!
//! Runs ONLY when `DOCHUB_TEST_PG_URL` is set (CI provides a Postgres service);
//! otherwise it prints a notice and passes, so local `cargo test` stays
//! SQLite-only. It proves the portable claim end-to-end on a real Postgres:
//! every migration applies, and a representative slice of repos round-trips —
//! exercising the `?`→`$n` placeholder rewrite (`Db::sql`), integer bind/read
//! coercion, TEXT ULIDs/timestamps, base64 vectors, transactions, and the
//! hash-chained audit log.

use dochub_db::{
    action, AuditRepo, Db, DbBackend, DbError, EmbeddingRepo, FileRepo, FileStatus, JobsRepo,
    NewAuditEvent, NewEmbedding, NewFile, NewJob, NewTag, NewUser, TagRepo, UserRepo,
    WorkspaceKind, WorkspaceRepo,
};

fn pg_url() -> Option<String> {
    std::env::var("DOCHUB_TEST_PG_URL")
        .ok()
        .filter(|s| !s.trim().is_empty())
}

#[tokio::test]
async fn postgres_migrations_and_repo_roundtrip() {
    let Some(url) = pg_url() else {
        eprintln!("DOCHUB_TEST_PG_URL not set — skipping Postgres smoke test");
        return;
    };

    // Connect runs every migration on Postgres.
    let db = Db::connect(&url)
        .await
        .expect("connect + migrate on Postgres");
    assert_eq!(db.backend(), DbBackend::Postgres);

    // Unique names so the test tolerates a re-used database.
    let uid = ulid::Ulid::new().to_string();
    let uname = format!("pg-user-{uid}");

    // Users: insert, find, unique violation, set_admin (integer bool bind/read).
    let users = UserRepo::new(&db);
    let u = users
        .insert(&NewUser {
            username: uname.clone(),
            password_hash: "hash".into(),
            is_admin: false,
        })
        .await
        .expect("insert user");
    assert_eq!(users.find_by_username(&uname).await.unwrap().id, u.id);
    let dup = users
        .insert(&NewUser {
            username: uname.clone(),
            password_hash: "hash".into(),
            is_admin: false,
        })
        .await;
    assert!(matches!(dup, Err(DbError::UniqueViolation(_))));
    users.set_admin(&u.id, true).await.unwrap();
    assert!(users.find_by_id(&u.id).await.unwrap().is_admin);

    // A Personal workspace is auto-created on user insert.
    let ws = WorkspaceRepo::new(&db)
        .list_for_user(&u.id)
        .await
        .unwrap()
        .into_iter()
        .find(|w| matches!(w.kind, WorkspaceKind::Personal))
        .expect("personal workspace")
        .id;

    // Files: insert + list_children (the refactored match-arm query).
    let files = FileRepo::new(&db);
    let fid = ulid::Ulid::new().to_string();
    files
        .insert(&NewFile {
            id: fid.clone(),
            parent_id: None,
            name: "report.md".into(),
            size: 12,
            content_type: None,
            etag: None,
            owner_id: u.id.clone(),
            workspace_id: ws.clone(),
            project_id: None,
            storage_id: None,
            status: FileStatus::Ready,
            expected_size: None,
        })
        .await
        .expect("insert file");
    let listed = files.list_children(None, &u.id).await.unwrap();
    assert!(listed.iter().any(|f| f.id == fid));

    // Embeddings: base64 vector + transaction (replace_for_file) + decode.
    let emb = EmbeddingRepo::new(&db);
    emb.replace_for_file(
        &fid,
        &ws,
        "hash-1",
        3,
        &[NewEmbedding {
            chunk_index: 0,
            vector: vec![0.25, -0.5, 0.75],
            chunk_text: "hello postgres".into(),
            char_start: 0,
            char_end: 14,
        }],
    )
    .await
    .expect("replace embeddings");
    let stored = emb.list_for_workspace(&ws).await.unwrap();
    let mine = stored.iter().find(|e| e.file_id == fid).unwrap();
    assert_eq!(mine.vector, vec![0.25, -0.5, 0.75]);

    // Jobs: enqueue → claim → mark_done (INTEGER + timestamps + optimistic UPDATE).
    let jobs = JobsRepo::new(&db);
    let job = jobs
        .enqueue(&NewJob {
            kind: "index_file".into(),
            payload: fid.clone(),
            max_attempts: None,
            run_after: None,
        })
        .await
        .expect("enqueue");
    let claimed = jobs
        .claim_next(time::OffsetDateTime::now_utc())
        .await
        .unwrap()
        .expect("a claimable job");
    assert_eq!(claimed.id, job.id);
    jobs.mark_done(&claimed.id).await.unwrap();

    // Tags: create + assign (composite-key upsert via portable delete-then-insert).
    let tags = TagRepo::new(&db);
    let tag = tags
        .get_or_create(&NewTag {
            workspace_id: ws.clone(),
            name: format!("tag-{uid}"),
            color: None,
            created_by: u.id.clone(),
        })
        .await
        .expect("create tag");
    tags.assign(&fid, &tag.id, &u.id).await.unwrap();
    assert!(tags
        .tags_for_file(&fid)
        .await
        .unwrap()
        .iter()
        .any(|t| t.id == tag.id));

    // Audit: append to the hash-chained log (transaction + chain head read).
    // Use `insert` (async, returns the row) rather than the fire-and-forget
    // `emit`, so the test synchronously exercises the chain.
    let audit = AuditRepo::new(&db);
    let event = audit
        .insert(NewAuditEvent {
            actor_id: Some(u.id.clone()),
            actor_username: Some(uname.clone()),
            action: action::VERSION_COMMIT.to_string(),
            target_kind: Some("file".into()),
            target_id: Some(fid.clone()),
            target_name: Some("report.md".into()),
            ip_address: None,
            metadata: None,
        })
        .await
        .expect("insert audit event");
    assert_eq!(event.target_id.as_deref(), Some(fid.as_str()));

    // The hash chain verifies clean on Postgres.
    assert!(matches!(
        audit.verify_audit_chain().await.unwrap(),
        dochub_db::AuditChainStatus::Intact
    ));
}
