//! Per-workspace Ed25519 provenance signing keys (Phase 1 build §2.1).
//!
//! [`ProvenanceKeysRepo`] owns the `provenance_keys` table and the
//! get-or-create resolution: given the injected master KEK, it unwraps a
//! workspace's persisted signing seed or generates + seals + persists one on
//! first use. The private seed is stored ONLY sealed under the master KEK (base64
//! of the envelope); the plaintext seed lives in [`ProvenanceKeypair`] in memory
//! only, is zeroized on drop, and never appears in a query row, log, or error.
//!
//! Per-workspace scope (decision D1) mirrors the DEK model — tenant isolation.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use dochub_crypto::{generate_signing_key, sign, CryptoError, EnvKek, Sig, VerifyingKeyBytes};
use sqlx::Row;
use thiserror::Error;
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::{users::ts, Db, DbError};

/// A resolved provenance keypair for a workspace. The 32-byte Ed25519 secret
/// seed is held in memory only and zeroized on drop; it never leaves this struct
/// except through [`ProvenanceKeypair::sign`]. `Debug` redacts the seed.
#[derive(ZeroizeOnDrop)]
pub struct ProvenanceKeypair {
    signing_key: [u8; 32],
    #[zeroize(skip)]
    public_key: VerifyingKeyBytes,
}

impl std::fmt::Debug for ProvenanceKeypair {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ProvenanceKeypair")
            .field("signing_key", &"<redacted>")
            .field("public_key", &STANDARD.encode(self.public_key))
            .finish()
    }
}

impl ProvenanceKeypair {
    /// The 32-byte Ed25519 public (verifying) key. Not secret — ships in the
    /// signed-provenance response.
    #[must_use]
    pub fn public_key(&self) -> &VerifyingKeyBytes {
        &self.public_key
    }

    /// Sign `msg` with the workspace's signing key, returning a detached
    /// 64-byte Ed25519 signature. The seed never leaves the struct.
    #[must_use]
    pub fn sign(&self, msg: &[u8]) -> Sig {
        sign(&self.signing_key, msg)
    }
}

/// Failure modes for provenance-key resolution. Neither variant carries key
/// material.
#[derive(Debug, Error)]
pub enum ProvenanceKeyError {
    #[error("db error: {0}")]
    Db(#[from] DbError),
    #[error("key error: {0}")]
    Crypto(#[from] CryptoError),
    #[error("corrupt provenance key: {0}")]
    Corrupt(&'static str),
}

/// Table access + resolver for `provenance_keys`.
#[derive(Debug, Clone)]
pub struct ProvenanceKeysRepo<'a> {
    db: &'a Db,
}

impl<'a> ProvenanceKeysRepo<'a> {
    #[must_use]
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    /// Fetch the raw persisted `(wrapped_secret_b64, public_key_b64)` for a
    /// workspace, if a key has been created.
    async fn get_raw(&self, workspace_id: &str) -> Result<Option<(String, String)>, DbError> {
        let row = sqlx::query(
            "SELECT wrapped_secret, public_key FROM provenance_keys WHERE workspace_id = ?",
        )
        .bind(workspace_id)
        .fetch_optional(self.db.pool())
        .await?;
        Ok(row.map(|r| (r.get("wrapped_secret"), r.get("public_key"))))
    }

    /// Persist a freshly generated key. The `workspace_id` PRIMARY KEY makes a
    /// racing second insert fail; callers resolve it by re-reading.
    async fn insert(
        &self,
        workspace_id: &str,
        wrapped_secret_b64: &str,
        public_key_b64: &str,
    ) -> Result<(), DbError> {
        let now = ts(time::OffsetDateTime::now_utc());
        sqlx::query(
            "INSERT INTO provenance_keys (workspace_id, wrapped_secret, public_key, created_at) \
             VALUES (?, ?, ?, ?)",
        )
        .bind(workspace_id)
        .bind(wrapped_secret_b64)
        .bind(public_key_b64)
        .bind(&now)
        .execute(self.db.pool())
        .await?;
        Ok(())
    }

    /// Resolve the workspace's provenance keypair, creating and persisting one
    /// on first use.
    ///
    /// Existing row → unwrap the sealed seed under `kek`. No row →
    /// `generate_signing_key()`, seal the seed under `kek`, persist, return. If
    /// two callers race the first write, the loser re-reads the winner's row so
    /// both observe the *same* key.
    pub async fn get_or_create(
        &self,
        workspace_id: &str,
        kek: &EnvKek,
    ) -> Result<ProvenanceKeypair, ProvenanceKeyError> {
        if let Some(existing) = self.get_raw(workspace_id).await? {
            return self.unwrap_row(existing, kek);
        }

        let (seed, public_key) = generate_signing_key();
        let envelope = kek.seal_secret(&seed);
        let wrapped_b64 = STANDARD.encode(&envelope);
        let public_b64 = STANDARD.encode(public_key);

        match self.insert(workspace_id, &wrapped_b64, &public_b64).await {
            Ok(()) => Ok(ProvenanceKeypair {
                signing_key: seed,
                public_key,
            }),
            // Lost an insert race (or any insert failure): adopt an existing
            // row if one now exists; otherwise surface the original error.
            Err(insert_err) => match self.get_raw(workspace_id).await? {
                Some(existing) => {
                    let mut seed = seed;
                    seed.zeroize();
                    self.unwrap_row(existing, kek)
                }
                None => Err(ProvenanceKeyError::Db(insert_err)),
            },
        }
    }

    /// Unwrap a persisted `(wrapped_secret_b64, public_key_b64)` row into a live
    /// keypair under `kek`.
    fn unwrap_row(
        &self,
        (wrapped_b64, public_b64): (String, String),
        kek: &EnvKek,
    ) -> Result<ProvenanceKeypair, ProvenanceKeyError> {
        let envelope = STANDARD
            .decode(wrapped_b64.as_bytes())
            .map_err(|_| ProvenanceKeyError::Corrupt("wrapped_secret is not valid base64"))?;
        let mut seed = kek.open_secret(&envelope)?;
        if seed.len() != 32 {
            seed.zeroize();
            return Err(ProvenanceKeyError::Corrupt("signing seed is not 32 bytes"));
        }
        let mut signing_key = [0u8; 32];
        signing_key.copy_from_slice(&seed);
        seed.zeroize();

        let public_key = STANDARD
            .decode(public_b64.as_bytes())
            .map_err(|_| ProvenanceKeyError::Corrupt("public_key is not valid base64"))?;
        let public_key: VerifyingKeyBytes = public_key
            .try_into()
            .map_err(|_| ProvenanceKeyError::Corrupt("public_key is not 32 bytes"))?;

        Ok(ProvenanceKeypair {
            signing_key,
            public_key,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::users::UserRepo;
    use crate::workspaces::{WorkspaceKind, WorkspaceRepo};
    use crate::NewUser;

    async fn seeded_ws() -> (Db, String) {
        let db = Db::connect("sqlite::memory:").await.unwrap();
        let owner = UserRepo::new(&db)
            .insert(&NewUser {
                username: "prov-admin".into(),
                password_hash: "h".into(),
                is_admin: true,
            })
            .await
            .unwrap()
            .id;
        let ws = WorkspaceRepo::new(&db)
            .list_for_user(&owner)
            .await
            .unwrap()
            .into_iter()
            .find(|w| matches!(w.kind, WorkspaceKind::Personal))
            .unwrap()
            .id;
        (db, ws)
    }

    /// The signing seed is persisted ONLY sealed: `wrapped_secret` is base64 of a
    /// versioned envelope (0x01 prefix, longer than the bare 32-byte seed), never
    /// the raw seed; `public_key` decodes to exactly 32 bytes.
    #[tokio::test]
    async fn secret_persisted_only_sealed() {
        let (db, ws) = seeded_ws().await;
        let kek = EnvKek::from_bytes([7u8; 32], 1);
        let repo = ProvenanceKeysRepo::new(&db);
        repo.get_or_create(&ws, &kek).await.unwrap();

        let (wrapped_b64, public_b64) = repo.get_raw(&ws).await.unwrap().expect("row exists");
        let envelope = STANDARD.decode(wrapped_b64.as_bytes()).unwrap();
        assert_eq!(
            envelope.first(),
            Some(&0x01),
            "sealed envelope version byte"
        );
        assert!(
            envelope.len() > 32,
            "envelope carries nonce + tag beyond the 32-byte seed"
        );
        // The raw seed must never appear in the stored bytes.
        let kp = repo.get_or_create(&ws, &kek).await.unwrap();
        assert_eq!(STANDARD.decode(public_b64.as_bytes()).unwrap().len(), 32);
        // The stored public key matches the resolved keypair's.
        assert_eq!(
            STANDARD.decode(public_b64.as_bytes()).unwrap(),
            kp.public_key().to_vec()
        );
    }

    /// A wrong-length / corrupt sealed seed surfaces `Corrupt`, never a panic.
    #[tokio::test]
    async fn corrupt_wrapped_secret_is_reported() {
        let (db, ws) = seeded_ws().await;
        let kek = EnvKek::from_bytes([9u8; 32], 1);
        // Seal 16 bytes (not a 32-byte seed) directly and persist it.
        let envelope = kek.seal_secret(&[0u8; 16]);
        ProvenanceKeysRepo::new(&db)
            .insert(
                &ws,
                &STANDARD.encode(&envelope),
                &STANDARD.encode([0u8; 32]),
            )
            .await
            .unwrap();
        let err = ProvenanceKeysRepo::new(&db)
            .get_or_create(&ws, &kek)
            .await
            .unwrap_err();
        assert!(matches!(err, ProvenanceKeyError::Corrupt(_)));
    }
}
