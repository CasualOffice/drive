//! Adapts the version registry to the WOPI host's [`DocumentStore`] port.
//!
//! Keeps `dochub-wopi` a thin protocol crate: it owns the trait, we own the
//! registry-backed implementation. GetFile/PutFile through the WOPI host thus
//! serve + commit through the encrypted version chain (build spec §5) like
//! every other read/write path — never plaintext at rest.

use async_trait::async_trait;
use dochub_authz::{require, AuthzError, Permission, ResourceRef};
use dochub_db::{Db, Registry, RegistryError};
use dochub_storage::StorageError;
use dochub_wopi::{DocStoreError, DocumentStore};

/// [`DocumentStore`] over a [`Registry`]. Workspace + head resolution happen
/// inside the registry (from the file row), so the WOPI host stays oblivious to
/// workspaces and DEKs.
///
/// It also re-authorizes the acting user against **live** grant state on every
/// read/commit. The WOPI access token is a short-lived stateless bearer, so
/// without this a grant revoked after the token was minted would keep working
/// until the token expired (review finding: TOCTOU on GetFile/PutFile). The
/// check lives here — not in the `dochub-wopi` protocol crate — because this is
/// where the authz database is in reach.
pub(crate) struct RegistryDocStore {
    registry: Registry,
    db: Db,
}

impl RegistryDocStore {
    pub(crate) fn new(registry: Registry, db: Db) -> Self {
        Self { registry, db }
    }

    /// Re-check the acting user still holds `perm` on `file_id`; map a denial to
    /// `Unauthorized` (401) and a lookup error to opaque `Internal`.
    async fn authorize(
        &self,
        file_id: &str,
        user_id: &str,
        perm: Permission,
    ) -> Result<(), DocStoreError> {
        match require(
            &self.db,
            user_id,
            &ResourceRef::File(file_id.to_string()),
            perm,
        )
        .await
        {
            Ok(()) => Ok(()),
            Err(AuthzError::Forbidden) => Err(DocStoreError::Unauthorized),
            Err(AuthzError::Db(e)) => Err(DocStoreError::Internal(e.to_string())),
        }
    }
}

#[async_trait]
impl DocumentStore for RegistryDocStore {
    async fn read(&self, file_id: &str, author_id: &str) -> Result<Vec<u8>, DocStoreError> {
        self.authorize(file_id, author_id, Permission::View).await?;
        self.registry
            .read_or_backfill_for_file(file_id, author_id)
            .await
            .map_err(map_err)
    }

    async fn commit(
        &self,
        file_id: &str,
        author_id: &str,
        bytes: Vec<u8>,
    ) -> Result<(), DocStoreError> {
        self.authorize(file_id, author_id, Permission::Edit).await?;
        self.registry
            .commit_for_file(file_id, &bytes, author_id, "wopi save")
            .await
            .map(|_| ())
            .map_err(map_err)
    }

    async fn size(&self, file_id: &str) -> Result<u64, DocStoreError> {
        self.registry.head_size(file_id).await.map_err(map_err)
    }
}

/// A missing file / workspace / blob is a WOPI 404; anything else is opaque.
fn map_err(e: RegistryError) -> DocStoreError {
    match e {
        RegistryError::VersionNotFound
        | RegistryError::NoWorkspace
        | RegistryError::Storage(StorageError::NotFound(_)) => DocStoreError::NotFound,
        other => DocStoreError::Internal(other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use dochub_db::{
        FileRepo, NewFile, NewUser, Registry, UserRepo, WorkspaceDeks, WorkspaceKind, WorkspaceRepo,
    };
    use dochub_storage::Storage;

    async fn personal_ws(db: &Db, user_id: &str) -> String {
        WorkspaceRepo::new(db)
            .list_for_user(user_id)
            .await
            .unwrap()
            .into_iter()
            .find(|w| matches!(w.kind, WorkspaceKind::Personal))
            .unwrap()
            .id
    }

    /// Continuous authorization: the WOPI store re-checks live grants on every
    /// read/commit, so a validly-minted token for a user who lacks access is
    /// denied at request time (Unauthorized), not served for the token's TTL.
    #[tokio::test]
    async fn store_denies_unauthorized_user_read_and_commit() {
        let db = Db::connect("sqlite::memory:").await.unwrap();
        let owner = UserRepo::new(&db)
            .insert(&NewUser {
                username: "owner".into(),
                password_hash: "h".into(),
                is_admin: false,
            })
            .await
            .unwrap()
            .id;
        let outsider = UserRepo::new(&db)
            .insert(&NewUser {
                username: "outsider".into(),
                password_hash: "h".into(),
                is_admin: false,
            })
            .await
            .unwrap()
            .id;
        let ws = personal_ws(&db, &owner).await;

        let file_id = ulid::Ulid::new().to_string();
        FileRepo::new(&db)
            .insert(&NewFile {
                id: file_id.clone(),
                parent_id: None,
                name: "secret.docx".into(),
                size: 0,
                content_type: Some("text/plain".into()),
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

        let storage = Storage::memory([9u8; 32]).unwrap();
        let deks = WorkspaceDeks::new(db.clone(), dochub_core::dev_master_kek());
        let registry = Registry::new(db.clone(), storage, deks);
        registry
            .commit_version(&ws, &file_id, b"head bytes", &owner, "seed")
            .await
            .unwrap();

        let store = RegistryDocStore::new(registry, db.clone());

        // Owner (workspace owner) reads and commits fine.
        assert_eq!(
            store.read(&file_id, &owner).await.unwrap(),
            b"head bytes".to_vec()
        );
        assert!(store.commit(&file_id, &owner, b"v2".to_vec()).await.is_ok());

        // Outsider — no membership, no grant — is denied both, as Unauthorized.
        assert!(matches!(
            store.read(&file_id, &outsider).await,
            Err(DocStoreError::Unauthorized)
        ));
        assert!(matches!(
            store.commit(&file_id, &outsider, b"evil".to_vec()).await,
            Err(DocStoreError::Unauthorized)
        ));
    }
}
