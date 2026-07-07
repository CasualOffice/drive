//! Retention policies (build spec §3 — P1.2 compliance layer).
//!
//! A retention policy records the minimum history a workspace must keep before
//! any *permanent purge* is allowed. Phase 1 is `retain`-only — a policy never
//! deletes anything on its own (D2 defers auto-purge to Phase 4). The purge
//! guard in `dochub-http` reads the active policy for a file's workspace and
//! rejects a permanent purge when a version is still inside the `min_age_days`
//! window or when the purge would drop the chain below `min_versions`. Trash /
//! tombstone (`files.trashed_at`) is always allowed under retention.
//!
//! This module is pure persistence over `retention_policies`; the enforcement
//! decision lives one layer up in `dochub-http`.

use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::{
    users::{parse_ts, ts},
    Db, DbError,
};

/// A stored retention policy row.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RetentionPolicy {
    pub id: String,
    pub workspace_id: String,
    /// `'workspace'` in Phase 1 (`'project'` / `'tag'` land later).
    pub scope: String,
    /// Keep at least N versions; `None` = keep all.
    pub min_versions: Option<i64>,
    /// Keep for at least N days; `None` = keep forever.
    pub min_age_days: Option<i64>,
    /// `'retain'` only in Phase 1 (no auto-purge).
    pub mode: String,
    pub created_at: time::OffsetDateTime,
}

/// The fields a caller supplies to set a policy.
#[derive(Debug, Clone)]
pub struct NewRetentionPolicy {
    pub workspace_id: String,
    pub scope: String,
    pub min_versions: Option<i64>,
    pub min_age_days: Option<i64>,
    pub mode: String,
}

#[derive(Debug, Clone)]
pub struct RetentionRepo<'a> {
    db: &'a Db,
}

impl<'a> RetentionRepo<'a> {
    #[must_use]
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    /// Insert a retention policy. Each call appends a new row; the most recent
    /// row for a workspace (by `created_at`) is the effective policy — see
    /// [`RetentionRepo::active_for_workspace`].
    pub async fn set(&self, new: &NewRetentionPolicy) -> Result<RetentionPolicy, DbError> {
        let id = ulid::Ulid::new().to_string();
        let created_at = time::OffsetDateTime::now_utc();
        let created_s = ts(created_at);
        sqlx::query(
            "INSERT INTO retention_policies \
             (id, workspace_id, scope, min_versions, min_age_days, mode, created_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(&new.workspace_id)
        .bind(&new.scope)
        .bind(new.min_versions)
        .bind(new.min_age_days)
        .bind(&new.mode)
        .bind(&created_s)
        .execute(self.db.pool())
        .await?;
        Ok(RetentionPolicy {
            id,
            workspace_id: new.workspace_id.clone(),
            scope: new.scope.clone(),
            min_versions: new.min_versions,
            min_age_days: new.min_age_days,
            mode: new.mode.clone(),
            created_at,
        })
    }

    /// Every policy set for a workspace, newest first.
    pub async fn list_for_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<Vec<RetentionPolicy>, DbError> {
        let rows = sqlx::query(
            "SELECT id, workspace_id, scope, min_versions, min_age_days, mode, created_at \
             FROM retention_policies WHERE workspace_id = ? ORDER BY created_at DESC, id DESC",
        )
        .bind(workspace_id)
        .fetch_all(self.db.pool())
        .await?;
        rows.iter().map(row_to_policy).collect()
    }

    /// The effective (most recently set) policy for a workspace, or `None` when
    /// the workspace has no policy. The purge guard consults this.
    pub async fn active_for_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<Option<RetentionPolicy>, DbError> {
        let row = sqlx::query(
            "SELECT id, workspace_id, scope, min_versions, min_age_days, mode, created_at \
             FROM retention_policies WHERE workspace_id = ? \
             ORDER BY created_at DESC, id DESC LIMIT 1",
        )
        .bind(workspace_id)
        .fetch_optional(self.db.pool())
        .await?;
        row.as_ref().map(row_to_policy).transpose()
    }
}

fn row_to_policy(row: &sqlx::any::AnyRow) -> Result<RetentionPolicy, DbError> {
    Ok(RetentionPolicy {
        id: row.get("id"),
        workspace_id: row.get("workspace_id"),
        scope: row.get("scope"),
        min_versions: row.try_get::<Option<i64>, _>("min_versions").ok().flatten(),
        min_age_days: row.try_get::<Option<i64>, _>("min_age_days").ok().flatten(),
        mode: row.get("mode"),
        created_at: parse_ts(row.get::<String, _>("created_at"))?,
    })
}
