//! Append-only audit log. Powers the `/activity` feed and (later) the
//! compliance JSON export.
//!
//! Writes are fire-and-forget from the handler's perspective — callers
//! `tokio::spawn` the `insert` so the request returns without waiting on
//! the DB. The append-only invariant lives in the schema (no UPDATE,
//! no DELETE statements anywhere); we don't enforce it with a trigger
//! to keep migrations portable across SQLite + Postgres.

use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::{
    users::{parse_ts, ts},
    Db, DbError,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEvent {
    pub id: String,
    pub created_at: time::OffsetDateTime,
    pub actor_id: Option<String>,
    pub actor_username: Option<String>,
    pub action: String,
    pub target_kind: Option<String>,
    pub target_id: Option<String>,
    pub target_name: Option<String>,
    pub ip_address: Option<String>,
    /// Verbatim JSON payload from `NewAuditEvent::metadata`, if any.
    pub metadata: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NewAuditEvent {
    pub actor_id: Option<String>,
    pub actor_username: Option<String>,
    pub action: String,
    pub target_kind: Option<String>,
    pub target_id: Option<String>,
    pub target_name: Option<String>,
    pub ip_address: Option<String>,
    /// Caller-supplied JSON object string. We don't parse it — callers
    /// build it with `serde_json::json!`.
    pub metadata: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AuditRepo<'a> {
    db: &'a Db,
}

impl<'a> AuditRepo<'a> {
    #[must_use]
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    pub async fn insert(&self, new: NewAuditEvent) -> Result<AuditEvent, DbError> {
        let id = ulid::Ulid::new().to_string();
        let created_at = time::OffsetDateTime::now_utc();
        sqlx::query(
            "INSERT INTO audit_log \
             (id, created_at, actor_id, actor_username, action, target_kind, \
              target_id, target_name, ip_address, metadata) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(ts(created_at))
        .bind(&new.actor_id)
        .bind(&new.actor_username)
        .bind(&new.action)
        .bind(&new.target_kind)
        .bind(&new.target_id)
        .bind(&new.target_name)
        .bind(&new.ip_address)
        .bind(&new.metadata)
        .execute(self.db.pool())
        .await?;
        Ok(AuditEvent {
            id,
            created_at,
            actor_id: new.actor_id,
            actor_username: new.actor_username,
            action: new.action,
            target_kind: new.target_kind,
            target_id: new.target_id,
            target_name: new.target_name,
            ip_address: new.ip_address,
            metadata: new.metadata,
        })
    }

    /// Fire-and-forget insert. Used by handlers that don't want to block
    /// the response on an audit write. Errors are logged, never returned.
    pub fn emit(db: &Db, event: NewAuditEvent) {
        let db = db.clone();
        tokio::spawn(async move {
            if let Err(e) = AuditRepo::new(&db).insert(event).await {
                tracing::warn!(error = %e, action = %"audit_emit_failed", "audit insert failed");
            }
        });
    }

    /// Page latest-first, filtered to one or more action strings. Used by
    /// the Admin → Recent sign-ins card. Empty `actions` returns nothing.
    pub async fn list_filtered(
        &self,
        actions: &[&str],
        limit: i64,
    ) -> Result<Vec<AuditEvent>, DbError> {
        if actions.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders = vec!["?"; actions.len()].join(", ");
        let sql = format!(
            "SELECT id, created_at, actor_id, actor_username, action, \
             target_kind, target_id, target_name, ip_address, metadata \
             FROM audit_log WHERE action IN ({placeholders}) \
             ORDER BY created_at DESC LIMIT ?",
        );
        let mut q = sqlx::query(&sql);
        for a in actions {
            q = q.bind(*a);
        }
        let rows = q
            .bind(limit.clamp(1, 200))
            .fetch_all(self.db.pool())
            .await?;
        rows.iter().map(row_to_event).collect()
    }

    /// Page latest-first. `before` is an opaque cursor (the previous
    /// page's last `created_at`); omit for the first page.
    pub async fn list(&self, before: Option<&str>, limit: i64) -> Result<Vec<AuditEvent>, DbError> {
        let rows = if let Some(before) = before {
            sqlx::query(
                "SELECT id, created_at, actor_id, actor_username, action, \
                 target_kind, target_id, target_name, ip_address, metadata \
                 FROM audit_log WHERE created_at < ? ORDER BY created_at DESC LIMIT ?",
            )
            .bind(before)
            .bind(limit.clamp(1, 500))
            .fetch_all(self.db.pool())
            .await?
        } else {
            sqlx::query(
                "SELECT id, created_at, actor_id, actor_username, action, \
                 target_kind, target_id, target_name, ip_address, metadata \
                 FROM audit_log ORDER BY created_at DESC LIMIT ?",
            )
            .bind(limit.clamp(1, 500))
            .fetch_all(self.db.pool())
            .await?
        };
        rows.iter().map(row_to_event).collect()
    }
}

fn row_to_event(row: &sqlx::any::AnyRow) -> Result<AuditEvent, DbError> {
    Ok(AuditEvent {
        id: row.get("id"),
        created_at: parse_ts(row.get::<String, _>("created_at"))?,
        actor_id: row.get("actor_id"),
        actor_username: row.get("actor_username"),
        action: row.get("action"),
        target_kind: row.get("target_kind"),
        target_id: row.get("target_id"),
        target_name: row.get("target_name"),
        ip_address: row.get("ip_address"),
        metadata: row.get("metadata"),
    })
}
