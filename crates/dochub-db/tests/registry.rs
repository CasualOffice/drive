//! Integration tests for the version + hash-chain registry (build spec §5).
//!
//! Real `sqlite::memory:` DB + the in-memory storage backend, exercising the
//! append-only history invariants (TESTING.md #3, #4, #5).

use bytes::Bytes;
use dochub_crypto::{BreakReason, ChainStatus};
use dochub_db::{
    Db, FileRepo, FileVersionsRepo, NewFile, Registry, WorkspaceDeks, WorkspaceKind, WorkspaceRepo,
};
use dochub_storage::Storage;

async fn fresh_db() -> Db {
    Db::connect("sqlite::memory:").await.expect("connect")
}

async fn seed_admin(db: &Db) -> String {
    dochub_db::UserRepo::new(db)
        .insert(&dochub_db::NewUser {
            username: "admin".into(),
            password_hash: "h".into(),
            is_admin: true,
        })
        .await
        .unwrap()
        .id
}

/// The auto-created Personal workspace for a freshly seeded user.
async fn personal_ws(db: &Db, user_id: &str) -> String {
    WorkspaceRepo::new(db)
        .list_for_user(user_id)
        .await
        .unwrap()
        .into_iter()
        .find(|w| matches!(w.kind, WorkspaceKind::Personal))
        .expect("Personal workspace")
        .id
}

/// Seed a user + workspace + one file row and return the pieces the registry
/// needs: `(registry, file_id, workspace_id, author_id, db, storage)`.
async fn fixture() -> (Registry, String, String, String, Db, Storage) {
    let db = fresh_db().await;
    let owner = seed_admin(&db).await;
    let ws = personal_ws(&db, &owner).await;

    let file_id = ulid::Ulid::new().to_string();
    FileRepo::new(&db)
        .insert(&NewFile {
            id: file_id.clone(),
            parent_id: None,
            name: "Report.md".into(),
            size: 0,
            content_type: Some("text/markdown".into()),
            etag: None,
            owner_id: owner.clone(),
            workspace_id: ws.clone(),
            project_id: None,
            storage_id: None,
            status: dochub_db::FileStatus::Ready,
            expected_size: None,
        })
        .await
        .unwrap();

    let storage = Storage::memory([7u8; 32]).unwrap();
    let deks = WorkspaceDeks::new(db.clone(), dochub_core::dev_master_kek());
    let registry = Registry::new(db.clone(), storage.clone(), deks);
    (registry, file_id, ws, owner, db, storage)
}

/// N commits → exactly N chained versions; each `prev_hash` equals the previous
/// `content_hash`; `files.version` tracks the head seq.
#[tokio::test]
async fn n_commits_form_an_n_link_chain() {
    let (registry, file_id, ws, author, db, _storage) = fixture().await;

    let payloads: [&[u8]; 4] = [b"v1 body", b"v2 body", b"v3 body", b"v4 body"];
    for (i, p) in payloads.iter().enumerate() {
        let v = registry
            .commit_version(&ws, &file_id, p, &author, "edit")
            .await
            .unwrap();
        let expected_seq = (i + 1) as i64;
        assert_eq!(v.seq, expected_seq);
        assert_eq!(v.size, p.len() as i64);
        assert_eq!(v.author_id, author);
        assert_eq!(v.reason.as_deref(), Some("edit"));

        // Head pointer on the file row moves with each commit.
        let file = FileRepo::new(&db).find_by_id(&file_id).await.unwrap();
        assert_eq!(i64::from(file.version), expected_seq);
    }

    let chain = FileVersionsRepo::new(&db)
        .list_chain(&file_id)
        .await
        .unwrap();
    assert_eq!(chain.len(), payloads.len());
    assert!(chain[0].prev_hash.is_none(), "seq=1 has no parent");
    for i in 1..chain.len() {
        assert_eq!(chain[i].seq, chain[i - 1].seq + 1, "seq is monotone");
        assert_eq!(
            chain[i].prev_hash.as_ref(),
            Some(&chain[i - 1].content_hash),
            "prev_hash points at the previous content_hash"
        );
    }

    // A well-formed chain verifies Intact.
    assert_eq!(
        registry.verify_chain(&file_id).await.unwrap(),
        ChainStatus::Intact
    );
}

/// A single commit is a valid one-link chain; a file with no versions is Intact.
#[tokio::test]
async fn empty_and_single_chains_verify() {
    let (registry, file_id, ws, author, _db, _storage) = fixture().await;

    // No versions yet → Intact (nothing to break).
    assert_eq!(
        registry.verify_chain(&file_id).await.unwrap(),
        ChainStatus::Intact
    );

    registry
        .commit_version(&ws, &file_id, b"only", &author, "edit")
        .await
        .unwrap();
    assert_eq!(
        registry.verify_chain(&file_id).await.unwrap(),
        ChainStatus::Intact
    );
}

/// Corrupting a stored version blob makes `verify_chain` report `Broken` at
/// exactly that version's index; an intact chain reports `Intact`.
#[tokio::test]
async fn corrupt_blob_breaks_chain_at_that_seq() {
    let (registry, file_id, ws, author, db, storage) = fixture().await;

    for p in [b"aaa".as_slice(), b"bbb".as_slice(), b"ccc".as_slice()] {
        registry
            .commit_version(&ws, &file_id, p, &author, "edit")
            .await
            .unwrap();
    }
    assert_eq!(
        registry.verify_chain(&file_id).await.unwrap(),
        ChainStatus::Intact,
        "intact before tampering"
    );

    // Overwrite the seq=2 blob's stored bytes with garbage (write straight to
    // the content-addressed key — simulating at-rest tampering).
    let chain = FileVersionsRepo::new(&db)
        .list_chain(&file_id)
        .await
        .unwrap();
    let victim = &chain[1];
    storage
        .put(&victim.storage_key, Bytes::from_static(b"TAMPERED"), None)
        .await
        .unwrap();

    match registry.verify_chain(&file_id).await.unwrap() {
        ChainStatus::Broken { at_index, reason } => {
            assert_eq!(at_index, 1, "break at seq=2 → index 1");
            assert_eq!(reason, BreakReason::ContentMismatch);
        }
        ChainStatus::Intact => panic!("tampered chain must not verify Intact"),
    }
}

/// A DESTROYED / lost version blob makes `verify_chain` report `Broken`
/// (`ContentMissing`) — a surfaced tamper alarm — rather than erroring out,
/// which the HTTP layer would otherwise turn into an opaque 500.
#[tokio::test]
async fn missing_blob_breaks_chain_not_error() {
    let (registry, file_id, ws, author, db, storage) = fixture().await;

    for p in [b"aaa".as_slice(), b"bbb".as_slice(), b"ccc".as_slice()] {
        registry
            .commit_version(&ws, &file_id, p, &author, "edit")
            .await
            .unwrap();
    }

    // Delete the seq=2 blob outright (bytes lost / destroyed at rest).
    let chain = FileVersionsRepo::new(&db)
        .list_chain(&file_id)
        .await
        .unwrap();
    let victim = &chain[1];
    storage.delete(&victim.storage_key).await.unwrap();

    match registry.verify_chain(&file_id).await.unwrap() {
        ChainStatus::Broken { at_index, reason } => {
            assert_eq!(at_index, 1, "break at seq=2 → index 1");
            assert_eq!(reason, BreakReason::ContentMissing);
        }
        ChainStatus::Intact => panic!("a destroyed blob must not verify Intact"),
    }
}

/// `restore_version(k)` appends a new head whose plaintext equals version k's,
/// and leaves k and the rest of the chain intact.
#[tokio::test]
async fn restore_is_additive_and_preserves_history() {
    let (registry, file_id, ws, author, db, storage) = fixture().await;

    let originals: [&[u8]; 3] = [b"first", b"second", b"third"];
    for p in &originals {
        registry
            .commit_version(&ws, &file_id, p, &author, "edit")
            .await
            .unwrap();
    }

    // Snapshot version 1 before the restore, to prove it is untouched.
    let v1_before = FileVersionsRepo::new(&db)
        .get(&file_id, 1)
        .await
        .unwrap()
        .expect("v1 exists");

    let restored = registry
        .restore_version(&file_id, 1, &author)
        .await
        .unwrap();

    // Additive: it is a NEW head at seq 4, not a mutation of seq 1.
    assert_eq!(restored.seq, 4);
    assert_eq!(restored.reason.as_deref(), Some("restore of v1"));

    // Its plaintext equals version 1's plaintext.
    let deks = WorkspaceDeks::new(db.clone(), dochub_core::dev_master_kek());
    let dek = deks.get_or_create(&ws).await.unwrap();
    let restored_key = dochub_storage::StorageKey::from_stored(restored.storage_key.clone());
    let restored_plaintext = storage.get_blob(&dek, &restored_key).await.unwrap();
    assert_eq!(restored_plaintext, originals[0]);

    // Version 1 is byte-identical to its pre-restore snapshot (nothing rewritten).
    let v1_after = FileVersionsRepo::new(&db)
        .get(&file_id, 1)
        .await
        .unwrap()
        .expect("v1 still exists");
    assert_eq!(v1_after, v1_before);

    // The full 4-link chain still verifies.
    assert_eq!(
        registry.verify_chain(&file_id).await.unwrap(),
        ChainStatus::Intact
    );
    let chain = FileVersionsRepo::new(&db)
        .list_chain(&file_id)
        .await
        .unwrap();
    assert_eq!(chain.len(), 4);
    let file = FileRepo::new(&db).find_by_id(&file_id).await.unwrap();
    assert_eq!(i64::from(file.version), 4);
}

/// Committing later versions never mutates an already-committed row — the
/// registry exposes no update/delete path, and earlier rows are stable across
/// subsequent commits.
#[tokio::test]
async fn committed_rows_are_immutable() {
    let (registry, file_id, ws, author, db, _storage) = fixture().await;

    let v1 = registry
        .commit_version(&ws, &file_id, b"one", &author, "edit")
        .await
        .unwrap();

    // Commit two more versions on top.
    registry
        .commit_version(&ws, &file_id, b"two", &author, "edit")
        .await
        .unwrap();
    registry
        .commit_version(&ws, &file_id, b"three", &author, "edit")
        .await
        .unwrap();

    // The seq=1 row is exactly what it was at commit time.
    let v1_now = FileVersionsRepo::new(&db)
        .get(&file_id, 1)
        .await
        .unwrap()
        .expect("v1 exists");
    assert_eq!(v1_now, v1, "an earlier version row must never change");
    assert!(v1_now.prev_hash.is_none());
}
