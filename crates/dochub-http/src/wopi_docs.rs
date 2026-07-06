//! Adapts the version registry to the WOPI host's [`DocumentStore`] port.
//!
//! Keeps `dochub-wopi` a thin protocol crate: it owns the trait, we own the
//! registry-backed implementation. GetFile/PutFile through the WOPI host thus
//! serve + commit through the encrypted version chain (build spec §5) like
//! every other read/write path — never plaintext at rest.

use async_trait::async_trait;
use dochub_db::{Registry, RegistryError};
use dochub_storage::StorageError;
use dochub_wopi::{DocStoreError, DocumentStore};

/// [`DocumentStore`] over a [`Registry`]. Workspace + head resolution happen
/// inside the registry (from the file row), so the WOPI host stays oblivious to
/// workspaces and DEKs.
pub(crate) struct RegistryDocStore {
    registry: Registry,
}

impl RegistryDocStore {
    pub(crate) fn new(registry: Registry) -> Self {
        Self { registry }
    }
}

#[async_trait]
impl DocumentStore for RegistryDocStore {
    async fn read(&self, file_id: &str, author_id: &str) -> Result<Vec<u8>, DocStoreError> {
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
