//! The version + hash-chain registry service (build spec §5 — the registry
//! core).
//!
//! This is the one place that ties the three foundations together: it seals
//! document bytes through the encrypted [`Storage`] facade, records an
//! immutable [`Version`] row through [`FileVersionsRepo`], and verifies the
//! append-only chain with [`dochub_crypto::chain`]. It sits above both
//! `dochub-storage` and the raw repos so no lower layer has to know about the
//! others.
//!
//! Invariants it upholds (CLAUDE.md rule 6, TESTING.md #3/#4/#5):
//!
//! - **Append-only.** [`Registry::commit_version`] is the *only* write path for
//!   document bytes, and it only ever appends. Nothing here updates or deletes a
//!   committed version.
//! - **Hash-chained.** `content_hash = SHA-256(ciphertext)` (the same digest the
//!   content-addressed `versions/{hash}` key is built from); `prev_hash` points
//!   at the previous version's `content_hash`.
//! - **Restore is additive.** [`Registry::restore_version`] re-commits an older
//!   version's plaintext as a *new* head; the original and the chain are
//!   untouched.

use std::str::FromStr;

use dochub_crypto::{verify_chain, ChainLink, ChainStatus, CryptoError, Sha256Hex};
use dochub_storage::{Storage, StorageError, StorageKey};
use thiserror::Error;

use crate::{
    file_versions::{FileVersionsRepo, NewVersion, Version},
    workspace_keys::{DekError, WorkspaceDeks},
    Db, DbError, FileRepo,
};

/// The `versions/{hash}` storage-key prefix. `content_hash` is the remainder.
const KEY_PREFIX: &str = "versions/";

/// Failure modes for the registry. None carry key material or plaintext.
#[derive(Debug, Error)]
pub enum RegistryError {
    #[error("db error: {0}")]
    Db(#[from] DbError),
    #[error("key error: {0}")]
    Dek(#[from] DekError),
    #[error("storage error: {0}")]
    Storage(#[from] StorageError),
    #[error("crypto error: {0}")]
    Crypto(#[from] CryptoError),
    /// A stored `storage_key` was not of the `versions/{hash}` shape.
    #[error("malformed storage key")]
    MalformedKey,
    /// The requested file has no workspace, so no DEK can be resolved.
    #[error("file has no workspace")]
    NoWorkspace,
    /// The requested version `(file_id, seq)` does not exist.
    #[error("version not found")]
    VersionNotFound,
}

/// Version registry service. Cheap to clone — every field is `Arc`-backed.
#[derive(Clone)]
pub struct Registry {
    db: Db,
    storage: Storage,
    deks: WorkspaceDeks,
}

impl std::fmt::Debug for Registry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // `deks` is deliberately opaque (holds the KEK); keep the whole service
        // opaque so no key material can leak through a derived print.
        f.debug_struct("Registry").finish_non_exhaustive()
    }
}

impl Registry {
    #[must_use]
    pub fn new(db: Db, storage: Storage, deks: WorkspaceDeks) -> Self {
        Self { db, storage, deks }
    }

    /// Append a new version of `file_id` from `plaintext`. **The only write
    /// path for document bytes.**
    ///
    /// Seals the bytes under the workspace DEK and writes them content-addressed
    /// (`versions/{sha256(ciphertext)}`), reads the current head's
    /// `content_hash` as this version's `prev_hash` (`None` for the first
    /// version — a pre-existing file with no history is treated as such), then
    /// appends the row at `seq = head.seq + 1` and moves `files.version` to the
    /// new head. Returns the committed [`Version`].
    pub async fn commit_version(
        &self,
        workspace: &str,
        file_id: &str,
        plaintext: &[u8],
        author_id: &str,
        reason: &str,
    ) -> Result<Version, RegistryError> {
        let dek = self.deks.get_or_create(workspace).await?;

        // Seal + content-address. The returned key is `versions/{content_hash}`
        // where `content_hash = SHA-256(ciphertext)`; that hex tail is exactly
        // the hash the chain records, so we reuse it rather than re-hashing.
        let key = self.storage.put_blob(&dek, plaintext).await?;
        let content_hash = key
            .as_str()
            .strip_prefix(KEY_PREFIX)
            .ok_or(RegistryError::MalformedKey)?
            .to_string();

        let versions = FileVersionsRepo::new(&self.db);
        let head = versions.head(file_id).await?;
        let (seq, prev_hash) = match head {
            Some(h) => (h.seq + 1, Some(h.content_hash)),
            None => (1, None),
        };

        let size = i64::try_from(plaintext.len()).unwrap_or(i64::MAX);
        let version = versions
            .append(&NewVersion {
                file_id: file_id.to_string(),
                seq,
                storage_key: key.into_string(),
                size,
                content_hash,
                prev_hash,
                author_id: author_id.to_string(),
                reason: Some(reason.to_string()),
            })
            .await?;

        // Move the head pointer. (Phase 3 will enqueue a reindex here.)
        FileRepo::new(&self.db)
            .set_version_head(file_id, seq, size)
            .await?;

        Ok(version)
    }

    /// Verify the append-only chain for `file_id`.
    ///
    /// Reads each version's stored ciphertext, recomputes `SHA-256(ciphertext)`
    /// and walks the `prev_hash` pointers via [`dochub_crypto::chain::verify_chain`].
    /// Returns [`ChainStatus::Intact`] for a consistent chain (including a file
    /// with no versions yet) or [`ChainStatus::Broken`] at the first bad link —
    /// whose `at_index` is `seq - 1`.
    pub async fn verify_chain(&self, file_id: &str) -> Result<ChainStatus, RegistryError> {
        let versions = FileVersionsRepo::new(&self.db).list_chain(file_id).await?;

        // Materialize ciphertext bytes + typed links, then verify. `content_hash`
        // is over the ciphertext, so ciphertext is exactly what we hash.
        let mut ciphertexts: Vec<Vec<u8>> = Vec::with_capacity(versions.len());
        let mut links: Vec<ChainLink> = Vec::with_capacity(versions.len());
        for v in &versions {
            let key = StorageKey::from_stored(v.storage_key.clone());
            ciphertexts.push(self.storage.read_ciphertext(&key).await?);
            links.push(ChainLink {
                content_hash: Sha256Hex::from_str(&v.content_hash)?,
                prev_hash: match &v.prev_hash {
                    Some(h) => Some(Sha256Hex::from_str(h)?),
                    None => None,
                },
            });
        }

        let pairs = ciphertexts.iter().map(Vec::as_slice).zip(links.iter());
        Ok(verify_chain(pairs))
    }

    /// Restore version `seq` of `file_id` by re-committing its plaintext as a
    /// new head. Additive: `seq` and the existing chain are untouched; the
    /// restored bytes land at `seq' = head.seq + 1` with reason
    /// `"restore of v{seq}"`.
    pub async fn restore_version(
        &self,
        file_id: &str,
        seq: i64,
        author_id: &str,
    ) -> Result<Version, RegistryError> {
        let file = FileRepo::new(&self.db)
            .find_by_id(file_id)
            .await
            .map_err(|_| RegistryError::VersionNotFound)?;
        let workspace = file.workspace_id.ok_or(RegistryError::NoWorkspace)?;

        let target = FileVersionsRepo::new(&self.db)
            .get(file_id, seq)
            .await?
            .ok_or(RegistryError::VersionNotFound)?;

        // Read the old plaintext back through the encrypted facade.
        let dek = self.deks.get_or_create(&workspace).await?;
        let key = StorageKey::from_stored(target.storage_key);
        let plaintext = self.storage.get_blob(&dek, &key).await?;

        let reason = format!("restore of v{seq}");
        self.commit_version(&workspace, file_id, &plaintext, author_id, &reason)
            .await
    }
}
