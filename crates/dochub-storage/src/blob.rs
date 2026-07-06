//! Encrypted, content-addressed blob layer (build spec §4).
//!
//! This is the *only* public path for document bytes into the backend. Every
//! blob is sealed with a per-workspace [`Dek`] before it reaches the raw
//! `opendal::Operator` (which stays private on [`Storage`]), so no plaintext
//! document byte is ever written at rest.
//!
//! Blobs are content-addressed on their *ciphertext*: the key is
//! `versions/{sha256_hex(ciphertext)}`. Writes are once — if the key already
//! exists the existing bytes are kept and the write is skipped (dedup). A
//! committed blob is never overwritten.

use dochub_crypto::{open, seal, Dek};
use sha2::{Digest, Sha256};

use crate::{validate_key, Storage, StorageError};

/// The storage location of an encrypted version blob: `versions/{hash}` where
/// `hash = sha256_hex(ciphertext)`. Opaque and content-addressed; construct it
/// only by writing a blob through [`Storage::put_blob`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StorageKey(String);

impl StorageKey {
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_string(self) -> String {
        self.0
    }
}

impl std::fmt::Display for StorageKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// Lowercase hex of `SHA-256(bytes)`.
fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(digest.len() * 2);
    for b in digest {
        use std::fmt::Write as _;
        let _ = write!(out, "{b:02x}");
    }
    out
}

impl Storage {
    /// Seal `plaintext` under `dek` and write it content-addressed, write-once.
    ///
    /// Returns `versions/{sha256_hex(ciphertext)}`. Because the seal uses a
    /// fresh random nonce, the same plaintext yields a different key each call;
    /// dedup happens at the *ciphertext* level — an identical ciphertext (i.e.
    /// the same key) is written at most once.
    pub async fn put_blob(
        &self,
        dek: &Dek,
        plaintext: &[u8],
    ) -> Result<StorageKey, StorageError> {
        let ciphertext = seal(dek, plaintext).0;
        self.write_once(&ciphertext).await
    }

    /// Read the blob at `key` and open it under `dek`, returning the plaintext.
    pub async fn get_blob(&self, dek: &Dek, key: &StorageKey) -> Result<Vec<u8>, StorageError> {
        validate_key(key.as_str())?;
        let ciphertext = self.op.read(key.as_str()).await.map_err(|e| match e.kind() {
            opendal::ErrorKind::NotFound => StorageError::NotFound(key.as_str().to_string()),
            _ => StorageError::Backend(e),
        })?;
        Ok(open(dek, &ciphertext.to_vec())?)
    }

    /// Content-address `ciphertext` and write it exactly once. If the key
    /// already holds bytes, the write is skipped (dedup) and the existing key
    /// is returned unchanged.
    async fn write_once(&self, ciphertext: &[u8]) -> Result<StorageKey, StorageError> {
        let key = format!("versions/{}", sha256_hex(ciphertext));
        validate_key(&key)?;
        if !self.op.exists(&key).await? {
            self.op.write(&key, ciphertext.to_vec()).await?;
        }
        Ok(StorageKey(key))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use dochub_crypto::generate_dek;

    fn key32() -> [u8; 32] {
        [3u8; 32]
    }

    /// Invariant TESTING.md #1: what lands on the backend is ciphertext, and
    /// the real facade round-trips it back to the exact plaintext.
    #[tokio::test]
    async fn no_plaintext_at_rest() {
        let storage = Storage::memory(key32()).unwrap();
        let dek = generate_dek();
        let plaintext = b"the quarterly report body, in the clear";

        let sk = storage.put_blob(&dek, plaintext).await.unwrap();

        // Inspect the raw bytes the backend actually stored.
        let stored = storage.op.read(sk.as_str()).await.unwrap().to_vec();
        assert_ne!(stored.as_slice(), plaintext, "stored bytes must be ciphertext");
        assert!(
            !stored
                .windows(plaintext.len())
                .any(|w| w == plaintext.as_slice()),
            "plaintext must not appear anywhere in the stored bytes"
        );

        // The stored bytes are a valid envelope that opens under the DEK.
        assert_eq!(open(&dek, &stored).unwrap(), plaintext);
        // And the facade's own read path round-trips.
        assert_eq!(storage.get_blob(&dek, &sk).await.unwrap(), plaintext);
    }

    /// Content-addressed: the key is `versions/{sha256(ciphertext)}`.
    #[tokio::test]
    async fn key_is_content_address_of_ciphertext() {
        let storage = Storage::memory(key32()).unwrap();
        let dek = generate_dek();

        let sk = storage.put_blob(&dek, b"payload").await.unwrap();
        let stored = storage.op.read(sk.as_str()).await.unwrap().to_vec();
        assert_eq!(sk.as_str(), format!("versions/{}", sha256_hex(&stored)));
    }

    /// Write-once / dedup: the same ciphertext key written twice does not
    /// error and does not overwrite the existing bytes.
    #[tokio::test]
    async fn write_once_is_dedup_not_overwrite() {
        let storage = Storage::memory(key32()).unwrap();
        let dek = generate_dek();

        // Seal once so we control the exact ciphertext (put_blob would reseal
        // with a fresh nonce and produce a different key each time).
        let ciphertext = seal(&dek, b"immutable version bytes").0;

        let k1 = storage.write_once(&ciphertext).await.unwrap();
        assert_eq!(k1.as_str(), format!("versions/{}", sha256_hex(&ciphertext)));
        assert_eq!(
            storage.op.read(k1.as_str()).await.unwrap().to_vec(),
            ciphertext
        );

        // Replace the stored bytes with a sentinel, then write the same
        // ciphertext again. If dedup holds, the second write is skipped and the
        // sentinel survives — proving no double-write / no overwrite.
        storage.op.write(k1.as_str(), b"SENTINEL".to_vec()).await.unwrap();
        let k2 = storage.write_once(&ciphertext).await.unwrap();
        assert_eq!(k1, k2, "same ciphertext resolves to the same key");
        assert_eq!(
            storage.op.read(k2.as_str()).await.unwrap().to_vec(),
            b"SENTINEL",
            "second write_once must not overwrite the existing key"
        );
    }

    /// A missing blob reports `NotFound`, not a decrypt error.
    #[tokio::test]
    async fn get_blob_missing_is_not_found() {
        let storage = Storage::memory(key32()).unwrap();
        let dek = generate_dek();
        let sk = StorageKey("versions/deadbeef".to_string());
        assert!(matches!(
            storage.get_blob(&dek, &sk).await.unwrap_err(),
            StorageError::NotFound(_)
        ));
    }
}
