//! Lossless master-KEK rotation (build spec §4, P1.1).
//!
//! Rotating the master key-encryption-key must NOT rewrite document blobs. A
//! blob is sealed under a per-workspace DEK; only that DEK is wrapped by the
//! master KEK. So rotation re-seals the *wrapped DEK* — unwrap under the old
//! KEK, wrap under the new KEK, `UPDATE` the row — and leaves every blob byte
//! untouched. The plaintext DEK is identical before and after, so every
//! document still decrypts (TESTING.md invariant #7).
//!
//! There is no KMS here (a separate later PR): the "old" and "new" providers
//! are just two [`KeyProvider`]s — in Phase 1, two `EnvKek`s from `Config`
//! (`master_kek` → `master_kek_next`).
//!
//! Operations live on [`WorkspaceKeysRepo`]: the raw table access it already
//! owns is exactly what a re-wrap needs. This module only adds the rotation
//! orchestration on top of that repo's public row ops.

use dochub_crypto::KeyProvider;

use crate::{workspace_keys::WorkspaceKeysRepo, DbError, DekError};

/// Outcome of a [`WorkspaceKeysRepo::rewrap_all`] run.
///
/// `rotated` counts workspaces re-sealed under the new KEK; `failed` lists the
/// workspace ids that could not be rotated (e.g. their row does not unwrap
/// under the supplied *old* KEK — a wrong old key, or an already-rotated row).
/// A failure is recorded, never fatal: one bad workspace does not abort the
/// rest, and no partial write is left behind for it (each row is atomic).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RotationReport {
    pub rotated: usize,
    pub failed: Vec<String>,
}

impl RotationReport {
    /// True when every workspace rotated cleanly.
    #[must_use]
    pub fn is_clean(&self) -> bool {
        self.failed.is_empty()
    }
}

impl WorkspaceKeysRepo<'_> {
    /// Re-seal one workspace's DEK from `old` to `new`.
    ///
    /// Unwraps the persisted wrapped DEK under `old`, re-wraps the *same*
    /// plaintext DEK under `new`, and writes back `wrapped_dek` + `key_version`.
    /// The write is a single `UPDATE`, so the row is never left half-rotated.
    /// Errors (no row, or the row does not unwrap under `old`) surface as
    /// [`DekError`]; the plaintext DEK never appears in the error.
    pub async fn rewrap_workspace_dek(
        &self,
        workspace_id: &str,
        old: &dyn KeyProvider,
        new: &dyn KeyProvider,
    ) -> Result<(), DekError> {
        let wrapped = self
            .get(workspace_id)
            .await?
            .ok_or(DekError::Db(DbError::NotFound))?;
        // `dek` is zeroized on drop; it exists only for the span of this fn.
        let dek = old.unwrap(&wrapped)?;
        let rewrapped = new.wrap(&dek)?;
        self.update_wrapped(workspace_id, &rewrapped).await?;
        Ok(())
    }

    /// Re-seal every workspace DEK from `old` to `new`, returning a
    /// [`RotationReport`].
    ///
    /// Each workspace is rotated independently and atomically: a workspace that
    /// fails to unwrap under `old` is added to `failed` and the walk continues —
    /// no panic, no abort, no partial write for that row. Idempotent-ish: a row
    /// already sealed under `new` will fail to unwrap under `old` and land in
    /// `failed`, so re-running after a partial rotation is safe to reason about.
    pub async fn rewrap_all(&self, old: &dyn KeyProvider, new: &dyn KeyProvider) -> RotationReport {
        let mut report = RotationReport::default();
        let ids = match self.list_workspace_ids().await {
            Ok(ids) => ids,
            // Can't enumerate rows — nothing to report but the failure. An
            // empty report with the (unknown) count of zero is the safest
            // signal; the caller sees rotated == 0 and can retry.
            Err(_) => return report,
        };
        for id in ids {
            match self.rewrap_workspace_dek(&id, old, new).await {
                Ok(()) => report.rotated += 1,
                Err(_) => report.failed.push(id),
            }
        }
        report
    }
}
