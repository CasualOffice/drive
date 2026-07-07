//! End-to-end repository tests against `sqlite::memory:`. Postgres support
//! comes online when CI gains a Postgres service.

use dochub_db::{
    Db, DbError, FileRepo, FolderRepo, NewFile, NewFolder, NewSession, NewUser, ProvenanceKeysRepo,
    SessionRepo, UserRepo, WorkspaceDeks, WorkspaceKeysRepo, WorkspaceKind, WorkspaceRepo,
};

async fn fresh_db() -> Db {
    Db::connect("sqlite::memory:").await.expect("connect")
}

#[tokio::test]
async fn migrate_then_users_roundtrip() {
    let db = fresh_db().await;
    let users = UserRepo::new(&db);

    let u = users
        .insert(&NewUser {
            username: "admin".into(),
            password_hash: "$argon2id$dummy".into(),
            is_admin: true,
        })
        .await
        .expect("insert");
    assert!(u.is_admin);

    let by_username = users.find_by_username("admin").await.expect("find");
    assert_eq!(by_username.id, u.id);
    assert!(by_username.is_admin);

    let by_id = users.find_by_id(&u.id).await.expect("find by id");
    assert_eq!(by_id.username, "admin");

    let missing = users.find_by_username("nobody").await;
    assert!(matches!(missing, Err(DbError::NotFound)));
}

#[tokio::test]
async fn users_unique_username() {
    let db = fresh_db().await;
    let users = UserRepo::new(&db);
    users
        .insert(&NewUser {
            username: "dup".into(),
            password_hash: "h".into(),
            is_admin: false,
        })
        .await
        .expect("first insert");
    let err = users
        .insert(&NewUser {
            username: "dup".into(),
            password_hash: "h".into(),
            is_admin: false,
        })
        .await
        .expect_err("second must fail");
    assert!(matches!(err, DbError::UniqueViolation(_)));
}

#[tokio::test]
async fn sessions_create_get_delete() {
    let db = fresh_db().await;
    let users = UserRepo::new(&db);
    let sessions = SessionRepo::new(&db);

    let u = users
        .insert(&NewUser {
            username: "admin".into(),
            password_hash: "h".into(),
            is_admin: true,
        })
        .await
        .unwrap();

    let s = sessions
        .insert(
            "session-id-1",
            &NewSession {
                user_id: u.id.clone(),
                csrf_token: "csrf".into(),
                ttl: time::Duration::hours(24),
            },
        )
        .await
        .unwrap();
    assert_eq!(s.user_id, u.id);
    assert!(!s.is_expired());

    let fetched = sessions.get("session-id-1").await.unwrap();
    assert_eq!(fetched.csrf_token, "csrf");

    sessions.delete("session-id-1").await.unwrap();
    assert!(matches!(
        sessions.get("session-id-1").await,
        Err(DbError::NotFound)
    ));
}

async fn seed_admin(db: &Db) -> String {
    UserRepo::new(db)
        .insert(&NewUser {
            username: "admin".into(),
            password_hash: "h".into(),
            is_admin: true,
        })
        .await
        .unwrap()
        .id
}

/// Returns the auto-created Personal workspace id for a freshly seeded user.
/// UserRepo::insert mandatorily creates one, so this is infallible in tests.
async fn personal_ws(db: &Db, user_id: &str) -> String {
    WorkspaceRepo::new(db)
        .list_for_user(user_id)
        .await
        .unwrap()
        .into_iter()
        .find(|w| matches!(w.kind, WorkspaceKind::Personal))
        .expect("user must have a Personal workspace")
        .id
}

#[tokio::test]
async fn folders_create_list_rename_move_trash_restore() {
    let db = fresh_db().await;
    let owner = seed_admin(&db).await;
    let ws = personal_ws(&db, &owner).await;
    let repo = FolderRepo::new(&db);

    let f1 = repo
        .insert(&NewFolder {
            parent_id: None,
            name: "Reports".into(),
            owner_id: owner.clone(),
            workspace_id: ws.clone(),
        })
        .await
        .unwrap();
    let f2 = repo
        .insert(&NewFolder {
            parent_id: Some(f1.id.clone()),
            name: "Q2".into(),
            owner_id: owner.clone(),
            workspace_id: ws.clone(),
        })
        .await
        .unwrap();

    let root = repo.list_children(None, &owner).await.unwrap();
    assert_eq!(root.len(), 1);
    assert_eq!(root[0].id, f1.id);

    let kids = repo.list_children(Some(&f1.id), &owner).await.unwrap();
    assert_eq!(kids.len(), 1);
    assert_eq!(kids[0].name, "Q2");

    repo.rename(&f2.id, "Q2-renamed").await.unwrap();
    assert_eq!(repo.find_by_id(&f2.id).await.unwrap().name, "Q2-renamed");

    repo.trash(&f2.id).await.unwrap();
    assert!(repo.find_by_id(&f2.id).await.unwrap().trashed_at.is_some());
    assert!(repo
        .list_children(Some(&f1.id), &owner)
        .await
        .unwrap()
        .is_empty());
    repo.restore(&f2.id).await.unwrap();
    let restored = repo.find_by_id(&f2.id).await.unwrap();
    assert!(restored.trashed_at.is_none());
    assert_eq!(restored.parent_id.as_deref(), Some(f1.id.as_str()));
}

#[tokio::test]
async fn files_insert_list_rename_overwrite_trash_restore() {
    let db = fresh_db().await;
    let owner = seed_admin(&db).await;
    let ws = personal_ws(&db, &owner).await;
    let folders = FolderRepo::new(&db);
    let files = FileRepo::new(&db);
    let root_folder = folders
        .insert(&NewFolder {
            parent_id: None,
            name: "Home".into(),
            owner_id: owner.clone(),
            workspace_id: ws.clone(),
        })
        .await
        .unwrap();

    let id = ulid::Ulid::new().to_string();
    files
        .insert(&NewFile {
            id: id.clone(),
            parent_id: Some(root_folder.id.clone()),
            name: "Budget Q2.xlsx".into(),
            size: 42,
            content_type: Some(
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet".into(),
            ),
            etag: None,
            owner_id: owner.clone(),
            workspace_id: ws.clone(),
            storage_id: None,
            status: dochub_db::FileStatus::Ready,
            expected_size: None,
        })
        .await
        .unwrap();

    let list = files
        .list_children(Some(&root_folder.id), &owner)
        .await
        .unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].name, "Budget Q2.xlsx");

    files.rename(&id, "Budget Q2 — final.xlsx").await.unwrap();
    files
        .record_overwrite(&id, 100, Some("etag-1"))
        .await
        .unwrap();
    let f = files.find_by_id(&id).await.unwrap();
    assert_eq!(f.name, "Budget Q2 — final.xlsx");
    assert_eq!(f.size, 100);
    assert_eq!(f.version, 2);

    files.trash(&id).await.unwrap();
    assert!(files
        .list_children(Some(&root_folder.id), &owner)
        .await
        .unwrap()
        .is_empty());
    files.restore(&id).await.unwrap();
    assert_eq!(
        files.find_by_id(&id).await.unwrap().parent_id.as_deref(),
        Some(root_folder.id.as_str())
    );
}

#[tokio::test]
async fn sessions_janitor_clears_expired() {
    let db = fresh_db().await;
    let users = UserRepo::new(&db);
    let sessions = SessionRepo::new(&db);
    let u = users
        .insert(&NewUser {
            username: "admin".into(),
            password_hash: "h".into(),
            is_admin: true,
        })
        .await
        .unwrap();
    sessions
        .insert(
            "live",
            &NewSession {
                user_id: u.id.clone(),
                csrf_token: "c".into(),
                ttl: time::Duration::hours(1),
            },
        )
        .await
        .unwrap();
    sessions
        .insert(
            "dead",
            &NewSession {
                user_id: u.id.clone(),
                csrf_token: "c".into(),
                ttl: time::Duration::seconds(-1),
            },
        )
        .await
        .unwrap();

    let cleaned = sessions.delete_expired().await.unwrap();
    assert_eq!(cleaned, 1);
    assert!(sessions.get("live").await.is_ok());
    assert!(matches!(sessions.get("dead").await, Err(DbError::NotFound)));
}

#[tokio::test]
async fn files_and_folders_are_workspace_scoped() {
    // Phase-2 invariant: list/search by workspace returns only rows
    // bound to that workspace, even when two workspaces share an owner.
    let db = fresh_db().await;
    let owner = seed_admin(&db).await;
    let personal = personal_ws(&db, &owner).await;
    let team = WorkspaceRepo::new(&db)
        .insert("Team", WorkspaceKind::Team, &owner)
        .await
        .unwrap()
        .id;

    let folders = FolderRepo::new(&db);
    let files = FileRepo::new(&db);

    folders
        .insert(&NewFolder {
            parent_id: None,
            name: "Personal-only".into(),
            owner_id: owner.clone(),
            workspace_id: personal.clone(),
        })
        .await
        .unwrap();
    folders
        .insert(&NewFolder {
            parent_id: None,
            name: "Team-only".into(),
            owner_id: owner.clone(),
            workspace_id: team.clone(),
        })
        .await
        .unwrap();

    files
        .insert(&NewFile {
            id: ulid::Ulid::new().to_string(),
            parent_id: None,
            name: "personal.docx".into(),
            size: 10,
            content_type: None,
            etag: None,
            owner_id: owner.clone(),
            workspace_id: personal.clone(),
            storage_id: None,
            status: dochub_db::FileStatus::Ready,
            expected_size: None,
        })
        .await
        .unwrap();
    files
        .insert(&NewFile {
            id: ulid::Ulid::new().to_string(),
            parent_id: None,
            name: "team.docx".into(),
            size: 25,
            content_type: None,
            etag: None,
            owner_id: owner.clone(),
            workspace_id: team.clone(),
            storage_id: None,
            status: dochub_db::FileStatus::Ready,
            expected_size: None,
        })
        .await
        .unwrap();

    let p_folders = folders
        .list_children_in_workspace(None, &personal)
        .await
        .unwrap();
    let t_folders = folders
        .list_children_in_workspace(None, &team)
        .await
        .unwrap();
    assert_eq!(p_folders.len(), 1);
    assert_eq!(p_folders[0].name, "Personal-only");
    assert_eq!(t_folders.len(), 1);
    assert_eq!(t_folders[0].name, "Team-only");

    let p_files = files
        .list_children_in_workspace(None, &personal)
        .await
        .unwrap();
    let t_files = files.list_children_in_workspace(None, &team).await.unwrap();
    assert_eq!(p_files.len(), 1);
    assert_eq!(p_files[0].name, "personal.docx");
    assert_eq!(t_files.len(), 1);
    assert_eq!(t_files[0].name, "team.docx");

    let p_search = files.search(&personal, "docx", 50).await.unwrap();
    let t_search = files.search(&team, "docx", 50).await.unwrap();
    assert_eq!(p_search.len(), 1);
    assert_eq!(p_search[0].name, "personal.docx");
    assert_eq!(t_search.len(), 1);
    assert_eq!(t_search[0].name, "team.docx");

    assert_eq!(files.workspace_used_bytes(&personal).await.unwrap(), 10);
    assert_eq!(files.workspace_used_bytes(&team).await.unwrap(), 25);
}

// --- workspace_keys / DEK resolver (build spec §3) ------------------------

/// `get_or_create` is idempotent per workspace and distinct across workspaces.
/// DEK bytes are never exposed, so equality is proven functionally: a blob
/// sealed under the first handle opens under the second handle of the SAME
/// workspace, and fails under a DIFFERENT workspace's key.
#[tokio::test]
async fn workspace_dek_get_or_create_roundtrip() {
    let db = fresh_db().await;
    let owner = seed_admin(&db).await;
    let ws1 = personal_ws(&db, &owner).await;
    let ws2 = WorkspaceRepo::new(&db)
        .insert("Team", WorkspaceKind::Team, &owner)
        .await
        .unwrap()
        .id;

    let deks = WorkspaceDeks::new(db.clone(), dochub_core::dev_master_kek());

    // First call creates + persists the row.
    let dek_a = deks.get_or_create(&ws1).await.unwrap();
    assert!(
        WorkspaceKeysRepo::new(&db)
            .get(&ws1)
            .await
            .unwrap()
            .is_some(),
        "first get_or_create must persist a wrapped DEK"
    );

    // Second call for the SAME workspace returns the SAME key (unwrapped from
    // the persisted row).
    let dek_a2 = deks.get_or_create(&ws1).await.unwrap();
    let blob = dochub_crypto::seal(&dek_a, b"registry payload");
    assert_eq!(
        dochub_crypto::open(&dek_a2, &blob.0).unwrap(),
        b"registry payload",
        "same workspace must resolve to the same DEK across calls"
    );

    // A DIFFERENT workspace gets a DIFFERENT key: opening ws1's blob under
    // ws2's DEK fails authentication.
    let dek_b = deks.get_or_create(&ws2).await.unwrap();
    assert!(
        dochub_crypto::open(&dek_b, &blob.0).is_err(),
        "distinct workspaces must have distinct DEKs"
    );
}

/// The wrapped DEK is persisted only in wrapped form: the stored column is
/// base64 and decodes to a versioned envelope, never the raw 32-byte key.
#[tokio::test]
async fn workspace_key_persisted_only_wrapped() {
    let db = fresh_db().await;
    let owner = seed_admin(&db).await;
    let ws = personal_ws(&db, &owner).await;

    let deks = WorkspaceDeks::new(db.clone(), dochub_core::dev_master_kek());
    deks.get_or_create(&ws).await.unwrap();

    let wrapped = WorkspaceKeysRepo::new(&db)
        .get(&ws)
        .await
        .unwrap()
        .expect("row exists");
    // Versioned envelope: 0x01 prefix, and longer than a bare 32-byte key
    // (version + nonce + ciphertext + tag).
    assert_eq!(wrapped.ct.first(), Some(&0x01));
    assert!(wrapped.ct.len() > 32);
    assert_eq!(wrapped.key_version, 1);
}

// --- provenance keys / Ed25519 signing key (build spec §2.1, P1.4) --------

/// `get_or_create` is idempotent per workspace: the second call resolves the
/// SAME key from the persisted (sealed) row. Proven functionally — the seed is
/// never exposed — by signing under one handle and verifying under the other's
/// public key.
#[tokio::test]
async fn provenance_key_get_or_create_is_persisted_and_idempotent() {
    let db = fresh_db().await;
    let owner = seed_admin(&db).await;
    let ws = personal_ws(&db, &owner).await;
    let kek = dochub_core::dev_master_kek();

    let repo = ProvenanceKeysRepo::new(&db);
    let kp1 = repo.get_or_create(&ws, &kek).await.unwrap();
    let sig = kp1.sign(b"manifest");

    // Second call for the SAME workspace unwraps the persisted row: same public
    // key, and it verifies kp1's signature.
    let kp2 = repo.get_or_create(&ws, &kek).await.unwrap();
    assert_eq!(kp1.public_key(), kp2.public_key());
    dochub_crypto::verify(kp2.public_key(), b"manifest", &sig).unwrap();
}

/// Different workspaces get different signing keys.
#[tokio::test]
async fn provenance_keys_are_per_workspace() {
    let db = fresh_db().await;
    let owner = seed_admin(&db).await;
    let ws1 = personal_ws(&db, &owner).await;
    let ws2 = WorkspaceRepo::new(&db)
        .insert("Team", WorkspaceKind::Team, &owner)
        .await
        .unwrap()
        .id;
    let kek = dochub_core::dev_master_kek();

    let repo = ProvenanceKeysRepo::new(&db);
    let kp1 = repo.get_or_create(&ws1, &kek).await.unwrap();
    let kp2 = repo.get_or_create(&ws2, &kek).await.unwrap();
    assert_ne!(kp1.public_key(), kp2.public_key());

    // ws1's signature must NOT verify under ws2's key.
    let sig = kp1.sign(b"x");
    assert!(dochub_crypto::verify(kp2.public_key(), b"x", &sig).is_err());
}

// --- KEK rotation / lossless re-wrap (build spec §4, P1.1) ----------------

/// TESTING.md invariant #7: KEK rotation is lossless. A DEK created under
/// KEK_A, re-wrapped A→B, unwraps under KEK_B to the SAME plaintext key — a
/// blob sealed BEFORE rotation still opens byte-identical afterwards. No
/// document blob is touched by the rotation.
#[tokio::test]
async fn rewrap_all_is_lossless_across_keks() {
    use dochub_crypto::KeyProvider;

    let db = fresh_db().await;
    let owner = seed_admin(&db).await;
    let ws = personal_ws(&db, &owner).await;

    let kek_a = dochub_core::dev_master_kek();
    let kek_b = dochub_core::dev_master_kek_next();

    // DEK created + persisted under KEK_A, then a blob sealed under it.
    let deks_a = WorkspaceDeks::new(db.clone(), kek_a.clone());
    let dek = deks_a.get_or_create(&ws).await.unwrap();
    let blob = dochub_crypto::seal(&dek, b"pre-rotation payload");

    // Rotate every workspace DEK from A to B.
    let report = WorkspaceKeysRepo::new(&db)
        .rewrap_all(kek_a.as_ref(), kek_b.as_ref())
        .await;
    assert_eq!(report.rotated, 1);
    assert!(report.is_clean(), "clean rotation has no failures");

    // The row now records the new KEK's version and unwraps under KEK_B to a
    // key that opens the PRE-rotation blob byte-identically.
    let wrapped = WorkspaceKeysRepo::new(&db)
        .get(&ws)
        .await
        .unwrap()
        .expect("row exists");
    assert_eq!(wrapped.key_version, 2, "re-wrap bumps key_version");
    let dek_under_b = kek_b.unwrap(&wrapped).unwrap();
    assert_eq!(
        dochub_crypto::open(&dek_under_b, &blob.0).unwrap(),
        b"pre-rotation payload",
        "blob sealed before rotation still decrypts under the rotated key",
    );

    // The resolver, now injected with KEK_B, transparently returns the same DEK.
    let resolver_b = WorkspaceDeks::new(db.clone(), kek_b.clone());
    let resolved = resolver_b.get_or_create(&ws).await.unwrap();
    assert_eq!(
        dochub_crypto::open(&resolved, &blob.0).unwrap(),
        b"pre-rotation payload",
    );
}

/// `rewrap_workspace_dek` bumps `key_version` and changes the wrapped bytes,
/// but the *plaintext* DEK underneath is unchanged.
#[tokio::test]
async fn rewrap_workspace_dek_changes_wrapping_not_dek() {
    use dochub_crypto::KeyProvider;

    let db = fresh_db().await;
    let owner = seed_admin(&db).await;
    let ws = personal_ws(&db, &owner).await;

    let kek_a = dochub_core::dev_master_kek();
    let kek_b = dochub_core::dev_master_kek_next();

    WorkspaceDeks::new(db.clone(), kek_a.clone())
        .get_or_create(&ws)
        .await
        .unwrap();

    let repo = WorkspaceKeysRepo::new(&db);
    let before = repo.get(&ws).await.unwrap().expect("row exists");
    assert_eq!(before.key_version, 1);

    repo.rewrap_workspace_dek(&ws, kek_a.as_ref(), kek_b.as_ref())
        .await
        .unwrap();

    let after = repo.get(&ws).await.unwrap().expect("row exists");
    assert_eq!(after.key_version, 2, "version bumps to the new KEK");
    assert_ne!(
        before.ct, after.ct,
        "wrapped bytes differ (re-sealed under a different KEK + fresh nonce)",
    );

    // Same underlying DEK: unwrap `before` under A and `after` under B, then
    // cross-check a seal/open across the two handles.
    let dek_before = kek_a.unwrap(&before).unwrap();
    let dek_after = kek_b.unwrap(&after).unwrap();
    let probe = dochub_crypto::seal(&dek_before, b"same-dek?");
    assert_eq!(
        dochub_crypto::open(&dek_after, &probe.0).unwrap(),
        b"same-dek?",
        "unwrapped DEK is identical before and after re-wrap",
    );
}

/// A workspace whose row does not unwrap under the supplied *old* KEK is
/// reported in `failed` — never a panic or an abort of the whole run — and its
/// row is left untouched.
#[tokio::test]
async fn rewrap_all_reports_unwrappable_as_failed() {
    use dochub_crypto::KeyProvider;

    let db = fresh_db().await;
    let owner = seed_admin(&db).await;
    let ws = personal_ws(&db, &owner).await;

    let kek_a = dochub_core::dev_master_kek();
    let kek_b = dochub_core::dev_master_kek_next();

    // Seal the DEK under A.
    WorkspaceDeks::new(db.clone(), kek_a.clone())
        .get_or_create(&ws)
        .await
        .unwrap();

    // Rotate with the WRONG old key (B): the row cannot be unwrapped under B.
    let report = WorkspaceKeysRepo::new(&db)
        .rewrap_all(kek_b.as_ref(), kek_a.as_ref())
        .await;
    assert_eq!(report.rotated, 0);
    assert_eq!(report.failed, vec![ws.clone()]);
    assert!(!report.is_clean());

    // The row is untouched: still unwraps under A at the original version.
    let row = WorkspaceKeysRepo::new(&db)
        .get(&ws)
        .await
        .unwrap()
        .expect("row exists");
    assert_eq!(
        row.key_version, 1,
        "failed rotation leaves the old row in place"
    );
    assert!(kek_a.unwrap(&row).is_ok());
}
