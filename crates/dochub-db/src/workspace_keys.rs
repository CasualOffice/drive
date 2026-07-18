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
            &self
                .db
                .sql("SELECT wrapped_dek, key_version FROM workspace_keys WHERE workspace_id = ?"),
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
        sqlx::query(&self.db.sql(
            "INSERT INTO workspace_keys (workspace_id, wrapped_dek, key_version, created_at) \
             VALUES (?, ?, ?, ?)",
        ))
        .bind(workspace_id)
        .bind(&b64)
        .bind(i64::from(wrapped.key_version))
        .bind(&now)
        .execute(self.db.pool())
        .await?;
        Ok(())
    }

    /// Re-seal an existing row's wrapped DEK. Overwrites `wrapped_dek` and
    /// `key_version` in place — the only column write a KEK rotation performs.
    /// Document blobs are untouched: the *plaintext* DEK is unchanged, so every
    /// blob still decrypts. Returns [`DbError::NotFound`] if no row exists for
    /// the workspace (callers rotate only rows they just read).
    pub async fn update_wrapped(
        &self,
        workspace_id: &str,
        wrapped: &WrappedDek,
    ) -> Result<(), DbError> {
        let b64 = STANDARD.encode(&wrapped.ct);
        let affected = sqlx::query(&self.db.sql(
            "UPDATE workspace_keys SET wrapped_dek = ?, key_version = ? WHERE workspace_id = ?",
        ))
        .bind(&b64)
        .bind(i64::from(wrapped.key_version))
        .bind(workspace_id)
        .execute(self.db.pool())
        .await?
        .rows_affected();
        if affected == 0 {
            return Err(DbError::NotFound);
        }
        Ok(())
    }

    /// Every workspace that has a persisted DEK. The unit of KEK rotation —
    /// `rewrap_all` walks this list. Order is unspecified; each row is rotated
    /// independently.
    pub async fn list_workspace_ids(&self) -> Result<Vec<String>, DbError> {
        let rows = sqlx::query(&self.db.sql("SELECT workspace_id FROM workspace_keys"))
            .fetch_all(self.db.pool())
            .await?;
        Ok(rows.into_iter().map(|r| r.get("workspace_id")).collect())
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
///
/// During a master-KEK rotation the resolver holds **two** KEKs: the current
/// one and an optional fallback (`master_kek_next`). Unwrap tries the current
/// KEK first, then the fallback — so a row already re-wrapped to the next KEK by
/// `rotate-kek` still reads on a server that hasn't promoted the key yet, and a
/// straggler left under the old KEK still reads after promotion while the old
/// key is kept configured as the fallback. New DEKs are always sealed under the
/// current KEK. This makes the rotation window read-safe (zero-downtime) rather
/// than throwing 500s on any workspace whose row is sealed under "the other"
/// key.
#[derive(Clone)]
pub struct WorkspaceDeks {
    db: Db,
    kek: Arc<EnvKek>,
    /// Optional second KEK tried on unwrap when the current one fails — the
    /// `master_kek_next` (or a retained old key) during a rotation. `None` in
    /// steady state.
    kek_next: Option<Arc<EnvKek>>,
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
        Self {
            db,
            kek,
            kek_next: None,
        }
    }

    /// Add a fallback KEK, tried on unwrap when the current one fails — the
    /// `master_kek_next` during a rotation (`None` in steady state). Keeping
    /// both keys configured across the whole transition is what makes rotation
    /// zero-downtime: unwrap succeeds whichever of the two sealed a given row.
    #[must_use]
    pub fn with_next_kek(mut self, kek_next: Option<Arc<EnvKek>>) -> Self {
        self.kek_next = kek_next;
        self
    }

    /// Unwrap a DEK trying the current KEK, then the fallback (if configured).
    /// A wrong key fails GCM authentication cleanly, so the fallback attempt
    /// can't produce a false positive. Returns the current KEK's error when
    /// both fail (the fallback's error is the less informative one).
    fn unwrap_any(&self, wrapped: &WrappedDek) -> Result<Dek, CryptoError> {
        match self.kek.unwrap(wrapped) {
            Ok(dek) => Ok(dek),
            Err(primary) => {
                if let Some(next) = self.kek_next.as_deref() {
                    if let Ok(dek) = next.unwrap(wrapped) {
                        return Ok(dek);
                    }
                }
                Err(primary)
            }
        }
    }

    /// Return the workspace's DEK, creating and persisting one on first use.
    ///
    /// Existing row → unwrap it (current KEK, then the rotation fallback). No
    /// row → `generate_dek()`, wrap under the current KEK, insert, return. If
    /// two callers race the first write, the loser's insert hits the PRIMARY KEY
    /// and it re-reads the winner's row so both observers get the *same* DEK.
    pub async fn get_or_create(&self, workspace_id: &str) -> Result<Dek, DekError> {
        let repo = WorkspaceKeysRepo::new(&self.db);

        if let Some(wrapped) = repo.get(workspace_id).await? {
            return Ok(self.unwrap_any(&wrapped)?);
        }

        let dek = generate_dek();
        let wrapped = self.kek.wrap(&dek)?;
        match repo.insert(workspace_id, &wrapped).await {
            Ok(()) => Ok(dek),
            // Lost an insert race (or any insert failure): if a row now
            // exists, adopt it; otherwise surface the original error.
            Err(insert_err) => match repo.get(workspace_id).await? {
                Some(existing) => Ok(self.unwrap_any(&existing)?),
                None => Err(DekError::Db(insert_err)),
            },
        }
    }
}
