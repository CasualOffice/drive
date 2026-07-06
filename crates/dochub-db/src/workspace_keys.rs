//! Per-workspace data-encryption keys (build spec §3, §4).
//!
//! Two pieces:
//!
//! - [`WorkspaceKeysRepo`] — the raw table access. It only ever sees the
//!   *wrapped* DEK (base64 of the envelope ciphertext); it holds no key
//!   material and does no crypto.
//! - [`WorkspaceDeks`] — the resolver. Given an injected master KEK (an
//!   `EnvKek` from `Config`), it turns a `workspace_id` into a live [`Dek`]:
//!   unwrapping the persisted row, or generating + wrapping + persisting one
//!   on first use.
//!
//! Plaintext DEKs exist only in memory and are zeroized on drop. Keys never
//! appear in logs, errors, or query rows.

use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use dochub_crypto::{generate_dek, CryptoError, Dek, EnvKek, KeyProvider, WrappedDek};
use sqlx::Row;
use thiserror::Error;

use crate::{users::ts, Db, DbError};

/// Table access for `workspace_keys`. Stores `WrappedDek.ct` base64-encoded in
/// the `wrapped_dek` TEXT column; the `key_version` is persisted alongside so a
/// future KEK rotation can re-wrap losslessly.
#[derive(Debug, Clone)]
pub struct WorkspaceKeysRepo<'a> {
    db: &'a Db,
}

impl<'a> WorkspaceKeysRepo<'a> {
    #[must_use]
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    /// Fetch the wrapped DEK for a workspace, if one has been created.
    pub async fn get(&self, workspace_id: &str) -> Result<Option<WrappedDek>, DbError> {
        let row = sqlx::query(
            "SELECT wrapped_dek, key_version FROM workspace_keys WHERE workspace_id = ?",
        )
        .bind(workspace_id)
        .fetch_optional(self.db.pool())
        .await?;

        let Some(row) = row else {
            return Ok(None);
        };
        let b64: String = row.get("wrapped_dek");
        let ct = STANDARD
            .decode(b64.as_bytes())
            .map_err(|_| DbError::Corrupt("workspace_keys.wrapped_dek is not valid base64"))?;
        let key_version: i64 = row.get("key_version");
        Ok(Some(WrappedDek {
            ct,
            key_version: key_version as u32,
        }))
    }

    /// Persist a wrapped DEK for a workspace. The `workspace_id` PRIMARY KEY
    /// makes this fail with a unique violation if a row already exists —
    /// callers that race resolve it by re-reading (see [`WorkspaceDeks`]).
    pub async fn insert(&self, workspace_id: &str, wrapped: &WrappedDek) -> Result<(), DbError> {
        let b64 = STANDARD.encode(&wrapped.ct);
        let now = ts(time::OffsetDateTime::now_utc());
        sqlx::query(
            "INSERT INTO workspace_keys (workspace_id, wrapped_dek, key_version, created_at) \
             VALUES (?, ?, ?, ?)",
        )
        .bind(workspace_id)
        .bind(&b64)
        .bind(i64::from(wrapped.key_version))
        .bind(&now)
        .execute(self.db.pool())
        .await?;
        Ok(())
    }
}

/// Failure modes for DEK resolution. Neither variant carries key material.
#[derive(Debug, Error)]
pub enum DekError {
    #[error("db error: {0}")]
    Db(#[from] DbError),
    #[error("key error: {0}")]
    Crypto(#[from] CryptoError),
}

/// Resolves a `workspace_id` to a live [`Dek`], wrapping the master KEK
/// (injected from `Config`, never global) around the persisted rows.
#[derive(Clone)]
pub struct WorkspaceDeks {
    db: Db,
    kek: Arc<EnvKek>,
}

impl std::fmt::Debug for WorkspaceDeks {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // `EnvKek` redacts itself, but keep the whole service opaque so no key
        // material can leak through a derived print of a wrapping struct.
        f.debug_struct("WorkspaceDeks").finish_non_exhaustive()
    }
}

impl WorkspaceDeks {
    #[must_use]
    pub fn new(db: Db, kek: Arc<EnvKek>) -> Self {
        Self { db, kek }
    }

    /// Return the workspace's DEK, creating and persisting one on first use.
    ///
    /// Existing row → unwrap it. No row → `generate_dek()`, wrap under the
    /// KEK, insert, return. If two callers race the first write, the loser's
    /// insert hits the PRIMARY KEY and it re-reads the winner's row so both
    /// observers get the *same* DEK.
    pub async fn get_or_create(&self, workspace_id: &str) -> Result<Dek, DekError> {
        let repo = WorkspaceKeysRepo::new(&self.db);

        if let Some(wrapped) = repo.get(workspace_id).await? {
            return Ok(self.kek.unwrap(&wrapped)?);
        }

        let dek = generate_dek();
        let wrapped = self.kek.wrap(&dek)?;
        match repo.insert(workspace_id, &wrapped).await {
            Ok(()) => Ok(dek),
            // Lost an insert race (or any insert failure): if a row now
            // exists, adopt it; otherwise surface the original error.
            Err(insert_err) => match repo.get(workspace_id).await? {
                Some(existing) => Ok(self.kek.unwrap(&existing)?),
                None => Err(DekError::Db(insert_err)),
            },
        }
    }
}
