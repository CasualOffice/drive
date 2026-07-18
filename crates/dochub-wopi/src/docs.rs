//! Document-bytes port for the WOPI host.
//!
//! The WOPI protocol handlers here must never touch plaintext at rest —
//! GetFile serves the encrypted version chain's head bytes and PutFile commits
//! a new immutable version (build spec §5, CLAUDE.md "no plaintext document
//! bytes are ever written to a storage backend").
//!
//! Rather than depend on `dochub-db`/`dochub-storage` directly, the WOPI crate
//! stays a thin protocol layer and depends on this [`DocumentStore`] port.
//! `dochub-http` supplies the real implementation over the version registry;
//! tests supply an in-memory fake.

use async_trait::async_trait;

/// Failure modes for a [`DocumentStore`]. Deliberately coarse — WOPI only
/// distinguishes "no such document" (404) from "everything else" (500), and no
/// variant carries key material or plaintext.
#[derive(Debug, thiserror::Error)]
pub enum DocStoreError {
    /// The document (or its bytes) does not exist.
    #[error("not found")]
    NotFound,
    /// The caller is not (or is no longer) authorized for this document. Lets
    /// the store re-check the acting identity's live permission on each op, so a
    /// grant revoked after the WOPI token was minted takes effect immediately
    /// rather than lingering for the token's TTL.
    #[error("unauthorized")]
    Unauthorized,
    /// Any other failure. The message is safe to log but not shown to clients.
    #[error("document store error: {0}")]
    Internal(String),
}

/// The document-bytes operations the WOPI host needs. Backed in production by
/// the encrypted version registry; the bytes crossing this boundary are always
/// plaintext, sealed/opened on the far side.
#[async_trait]
pub trait DocumentStore: Send + Sync {
    /// The current head bytes for `file_id`, lazily backfilling a first version
    /// from any legacy plaintext blob. `author_id` attributes a backfill commit.
    async fn read(&self, file_id: &str, author_id: &str) -> Result<Vec<u8>, DocStoreError>;

    /// Commit `bytes` as a new immutable version of `file_id`, attributed to
    /// `author_id`.
    async fn commit(
        &self,
        file_id: &str,
        author_id: &str,
        bytes: Vec<u8>,
    ) -> Result<(), DocStoreError>;

    /// Logical byte length of the head version, or `0` when there is none.
    async fn size(&self, file_id: &str) -> Result<u64, DocStoreError>;
}
