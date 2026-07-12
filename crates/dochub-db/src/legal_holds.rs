//! Legal holds (build spec §3 — P1.2 compliance layer).
//!
//! An active legal hold freezes a file / project / workspace against
//! destruction. [`LegalHoldsRepo::active_holds_for`] resolves a file to every
//! active hold that covers it — directly (`target_kind = 'file'`), via its
//! project / parent folder (`'project'`), or via its workspace (`'workspace'`).
//! The `hold_guard` in `dochub-http` calls it on every destructive path and,
//! when the returned set is non-empty, rejects with `409 UnderLegalHold`.
//!
//! Releasing a hold stamps `released_at` — rows are never deleted, so the record
//! that a hold once existed is permanent (compliance evidence).

use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::{
    files::File,
    users::{parse_ts, ts},
    Db, DbError,
};

/// The three target scopes a hold can cover.
pub mod target_kind {
    pub const FILE: &str = "file";
    pub const PROJECT: &str = "project";
    pub const WORKSPACE: &str = "workspace";
}

/// A stored legal-hold row. `released_at.is_none()` means the hold is active.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LegalHold {
    pub id: String,
    pub workspace_id: String,
    pub target_kind: String,
    pub target_id: Option<String>,
    pub reason: String,
    pub placed_by: String,
    pub placed_at: time::OffsetDateTime,
    pub released_at: Option<time::OffsetDateTime>,
}

impl LegalHold {
    #[must_use]
    pub fn is_active(&self) -> bool {
        self.released_at.is_none()
    }
}

/// The fields a caller supplies to place a hold.
#[derive(Debug, Clone)]
pub struct NewLegalHold {
    pub workspace_id: String,
    pub target_kind: String,
    pub target_id: Option<String>,
    pub reason: String,
    pub placed_by: String,
}

#[derive(Debug, Clone)]
pub struct LegalHoldsRepo<'a> {
    db: &'a Db,
}

impl<'a> LegalHoldsRepo<'a> {
    #[must_use]
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    /// Place a new (active) hold.
    pub async fn place(&self, new: &NewLegalHold) -> Result<LegalHold, DbError> {
        let id = ulid::Ulid::new().to_string();
        let placed_at = time::OffsetDateTime::now_utc();
        let placed_s = ts(placed_at);
        sqlx::query(&self.db.sql(
            "INSERT INTO legal_holds \
             (id, workspace_id, target_kind, target_id, reason, placed_by, placed_at, released_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, NULL)",
        ))
        .bind(&id)
        .bind(&new.workspace_id)
        .bind(&new.target_kind)
        .bind(&new.target_id)
        .bind(&new.reason)
        .bind(&new.placed_by)
        .bind(&placed_s)
        .execute(self.db.pool())
        .await?;
        Ok(LegalHold {
            id,
            workspace_id: new.workspace_id.clone(),
            target_kind: new.target_kind.clone(),
            target_id: new.target_id.clone(),
            reason: new.reason.clone(),
            placed_by: new.placed_by.clone(),
            placed_at,
            released_at: None,
        })
    }

    /// Release a hold by id: stamp `released_at` if it is still active. Returns
    /// the updated row, or `None` when no such hold exists. Idempotent — an
    /// already-released hold keeps its original `released_at`.
    pub async fn release(&self, id: &str) -> Result<Option<LegalHold>, DbError> {
        let now_s = ts(time::OffsetDateTime::now_utc());
        sqlx::query(
            &self
                .db
                .sql("UPDATE legal_holds SET released_at = ? WHERE id = ? AND released_at IS NULL"),
        )
        .bind(&now_s)
        .bind(id)
        .execute(self.db.pool())
        .await?;
        self.find_by_id(id).await
    }

    pub async fn find_by_id(&self, id: &str) -> Result<Option<LegalHold>, DbError> {
        let row = sqlx::query(&self.db.sql(
            "SELECT id, workspace_id, target_kind, target_id, reason, placed_by, \
             placed_at, released_at FROM legal_holds WHERE id = ?",
        ))
        .bind(id)
        .fetch_optional(self.db.pool())
        .await?;
        row.as_ref().map(row_to_hold).transpose()
    }

    /// Holds in a workspace. `active_only` filters to `released_at IS NULL`.
    pub async fn list_for_workspace(
        &self,
        workspace_id: &str,
        active_only: bool,
    ) -> Result<Vec<LegalHold>, DbError> {
        let sql = if active_only {
            "SELECT id, workspace_id, target_kind, target_id, reason, placed_by, \
             placed_at, released_at FROM legal_holds \
             WHERE workspace_id = ? AND released_at IS NULL \
             ORDER BY placed_at DESC, id DESC"
        } else {
            "SELECT id, workspace_id, target_kind, target_id, reason, placed_by, \
             placed_at, released_at FROM legal_holds \
             WHERE workspace_id = ? ORDER BY placed_at DESC, id DESC"
        };
        let rows = sqlx::query(&self.db.sql(sql))
            .bind(workspace_id)
            .fetch_all(self.db.pool())
            .await?;
        rows.iter().map(row_to_hold).collect()
    }

    /// Every active hold that covers `file`, resolving file → project → workspace
    /// scope. A file is covered when an active hold in its workspace is:
    ///   * `target_kind = 'workspace'` (workspace-wide), or
    ///   * `target_kind = 'file'` with `target_id = file.id`, or
    ///   * `target_kind = 'project'` with `target_id` equal to the file's parent
    ///     folder (its current `parent_id` or, for an already-trashed file, its
    ///     `original_parent_id`).
    ///
    /// A file with no `workspace_id` (a rare pre-workspaces legacy row) can carry
    /// no workspace-scoped holds, so the set is empty.
    pub async fn active_holds_for(&self, file: &File) -> Result<Vec<LegalHold>, DbError> {
        let Some(workspace_id) = file.workspace_id.as_deref() else {
            return Ok(Vec::new());
        };
        // A NULL bind never matches `target_id = ?` in SQL, so passing `None`
        // parent candidates is safe — they simply cover nothing.
        let rows = sqlx::query(&self.db.sql(
            "SELECT id, workspace_id, target_kind, target_id, reason, placed_by, \
             placed_at, released_at FROM legal_holds \
             WHERE released_at IS NULL AND workspace_id = ? AND ( \
                 target_kind = 'workspace' \
                 OR (target_kind = 'file' AND target_id = ?) \
                 OR (target_kind = 'project' AND (target_id = ? OR target_id = ?)) \
             ) \
             ORDER BY placed_at ASC, id ASC",
        ))
        .bind(workspace_id)
        .bind(&file.id)
        .bind(&file.parent_id)
        .bind(&file.original_parent_id)
        .fetch_all(self.db.pool())
        .await?;
        rows.iter().map(row_to_hold).collect()
    }
}

fn row_to_hold(row: &sqlx::any::AnyRow) -> Result<LegalHold, DbError> {
    Ok(LegalHold {
        id: row.get("id"),
        workspace_id: row.get("workspace_id"),
        target_kind: row.get("target_kind"),
        target_id: row.try_get::<Option<String>, _>("target_id").ok().flatten(),
        reason: row.get("reason"),
        placed_by: row.get("placed_by"),
        placed_at: parse_ts(row.get::<String, _>("placed_at"))?,
        released_at: row
            .try_get::<Option<String>, _>("released_at")?
            .map(parse_ts)
            .transpose()?,
    })
}
