//! Append-only, hash-chained audit log (build spec §6). Powers the
//! `/activity` feed and (later) the compliance JSON export.
//!
//! Writes are fire-and-forget from the handler's perspective — callers
//! `tokio::spawn` the `insert` so the request returns without waiting on
//! the DB. The append-only invariant lives in the schema (no UPDATE,
//! no DELETE statements anywhere); we don't enforce it with a trigger
//! to keep migrations portable across SQLite + Postgres.
//!
//! # Tamper-evidence (§6)
//!
//! Every appended row joins a single **global** hash chain (scope decision D1;
//! `audit_log` has no `workspace_id`, so a global chain is the simplest correct
//! option — per-workspace chains are a later refinement). Each row records the
//! previous chained row's `entry_hash` in `prev_hash` (NULL at the head) and its
//! own `entry_hash` over a canonical serialization of its stable fields:
//!
//! ```text
//! entry_hash = dochub_crypto::entry_hash(prev, canonical)
//!            = SHA-256( prev_hex ‖ 0x00 ‖ canonical )
//! ```
//!
//! where `canonical` is [`canonical`]'s length-prefixed encoding of, in fixed
//! order, `(id, created_at, actor_id, action, target_kind, target_id,
//! ip_address, metadata)`. [`AuditRepo::verify_audit_chain`] recomputes the
//! whole chain and reports the first break; committed rows are never
//! `UPDATE`/`DELETE`d.
//!
//! ## Single-writer assumption (Phase 0)
//!
//! Appends read the current chain head and insert the successor in one
//! transaction. Phase 0 assumes a single audit writer: SQLite is capped at one
//! connection (`pool.rs`), so appends serialize there; a concurrent second
//! writer under Postgres could read the same head and fork the chain. Verified
//! single-writer serialization (advisory lock / dedicated writer task) is a
//! Phase 1 hardening — the read-head-then-append transaction is the seam.

use serde::{Deserialize, Serialize};
use sqlx::Row;

use dochub_crypto::{entry_hash, Sha256Hex};

use crate::{
    users::{parse_ts, ts},
    Db, DbError,
};

/// The audit action vocabulary. Actions are dotted, namespaced strings
/// (`"auth.sign_in"`, `"files.upload"`, …); most are still written as string
/// literals at their handler call sites. The Phase-0 registry / boot actions
/// (build spec §6) are named here so the immutable-history events that gate the
/// compliance story share one source of truth.
pub mod action {
    /// A new immutable version was committed (`registry::commit_version`).
    pub const VERSION_COMMIT: &str = "version.commit";
    /// An older version was restored as a new head (`registry::restore_version`).
    pub const VERSION_RESTORE: &str = "version.restore";
    /// A file was tombstoned (soft-deleted; bytes retained per hold).
    pub const FILE_TOMBSTONE: &str = "file.tombstone";
    /// An ingest was rejected by the allowlist / magic-byte guard.
    pub const INGEST_REJECT: &str = "ingest.reject";
    /// A per-workspace DEK was generated + wrapped on first write.
    pub const KEY_WORKSPACE_CREATED: &str = "key.workspace_created";
    /// A boot invariant failed; the process is refusing to start.
    pub const BOOT_INVARIANT_FAILED: &str = "boot.invariant_failed";
    /// A legal hold was placed on a file / project / workspace (P1.2 compliance).
    pub const HOLD_PLACED: &str = "hold.placed";
    /// A legal hold was released (`released_at` stamped).
    pub const HOLD_RELEASED: &str = "hold.released";
    /// A workspace retention policy was set (P1.2 compliance).
    pub const RETENTION_SET: &str = "retention.set";
    /// A personal access token was issued.
    pub const TOKEN_CREATED: &str = "token.created";
    /// A personal access token was revoked.
    pub const TOKEN_REVOKED: &str = "token.revoked";
}

/// Outcome of [`AuditRepo::verify_audit_chain`].
///
/// A dedicated status (rather than reusing [`dochub_crypto::ChainStatus`])
/// because the audit chain hashes an `entry_hash` preimage rather than raw
/// content bytes; the break location is all a caller needs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuditChainStatus {
    /// Every chained row's `entry_hash` recomputed and every `prev_hash` linked.
    Intact,
    /// The first failing row, by zero-based position in chain order.
    Broken {
        /// Zero-based index (chain order) of the first tampered / mislinked row.
        at_index: usize,
    },
}

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

    /// Append one audit event, extending the global hash chain.
    ///
    /// In a single transaction: read the current chain head's `entry_hash`
    /// (deterministic order `created_at DESC, id DESC`, skipping pre-migration
    /// rows whose `entry_hash` is NULL), set it as this row's `prev_hash`
    /// (`None` at the head), compute `entry_hash = SHA-256(prev_hex ‖ 0x00 ‖
    /// canonical)`, and insert with both columns set.
    pub async fn insert(&self, new: NewAuditEvent) -> Result<AuditEvent, DbError> {
        let id = ulid::Ulid::new().to_string();
        let created_at = time::OffsetDateTime::now_utc();
        let created_s = ts(created_at);

        let mut tx = self.db.pool().begin().await?;

        // Chain head: the most recent chained row's entry_hash. Rows predating
        // migration 0017 have a NULL entry_hash and sit outside the chain.
        let head_row = sqlx::query(&self.db.sql(
            "SELECT entry_hash FROM audit_log \
             WHERE entry_hash IS NOT NULL \
             ORDER BY created_at DESC, id DESC LIMIT 1",
        ))
        .fetch_optional(&mut *tx)
        .await?;
        let prev: Option<Sha256Hex> = match head_row {
            Some(row) => {
                let hex: String = row.get("entry_hash");
                Some(
                    hex.parse()
                        .map_err(|_| DbError::Corrupt("audit entry_hash"))?,
                )
            }
            None => None,
        };

        let canonical = canonical(&CanonicalFields {
            id: &id,
            created_at: &created_s,
            actor_id: new.actor_id.as_deref(),
            action: &new.action,
            target_kind: new.target_kind.as_deref(),
            target_id: new.target_id.as_deref(),
            ip_address: new.ip_address.as_deref(),
            metadata: new.metadata.as_deref(),
        });
        let entry = entry_hash(prev.as_ref(), &canonical);

        sqlx::query(&self.db.sql(
            "INSERT INTO audit_log \
             (id, created_at, actor_id, actor_username, action, target_kind, \
              target_id, target_name, ip_address, metadata, prev_hash, entry_hash) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ))
        .bind(&id)
        .bind(&created_s)
        .bind(&new.actor_id)
        .bind(&new.actor_username)
        .bind(&new.action)
        .bind(&new.target_kind)
        .bind(&new.target_id)
        .bind(&new.target_name)
        .bind(&new.ip_address)
        .bind(&new.metadata)
        .bind(prev.map(|p| p.to_hex()))
        .bind(entry.to_hex())
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;

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

    /// Verify the global audit hash chain end-to-end.
    ///
    /// Walks chained rows in append order (`created_at ASC, id ASC`, skipping
    /// pre-migration NULL-`entry_hash` rows). For each row it recomputes
    /// `entry_hash` from the row's own fields + stored `prev_hash` and checks it
    /// against the stored `entry_hash` (catches any field / pointer tamper), and
    /// checks the `prev_hash` links to the previous row's `entry_hash` (catches
    /// reordering / splicing). Returns [`AuditChainStatus::Broken`] at the first
    /// failing index, else [`AuditChainStatus::Intact`] (including the empty and
    /// single-row chains). Never mutates anything.
    pub async fn verify_audit_chain(&self) -> Result<AuditChainStatus, DbError> {
        let rows = sqlx::query(&self.db.sql(
            "SELECT id, created_at, actor_id, action, target_kind, target_id, \
             ip_address, metadata, prev_hash, entry_hash \
             FROM audit_log WHERE entry_hash IS NOT NULL \
             ORDER BY created_at ASC, id ASC",
        ))
        .fetch_all(self.db.pool())
        .await?;

        let mut prev: Option<Sha256Hex> = None;
        for (i, row) in rows.iter().enumerate() {
            let id: String = row.get("id");
            let created_s: String = row.get("created_at");
            let actor_id: Option<String> = row.get("actor_id");
            let act: String = row.get("action");
            let target_kind: Option<String> = row.get("target_kind");
            let target_id: Option<String> = row.get("target_id");
            let ip_address: Option<String> = row.get("ip_address");
            let metadata: Option<String> = row.get("metadata");
            let stored_prev_hex: Option<String> = row.get("prev_hash");
            let stored_entry_hex: String = row.get("entry_hash");

            let stored_prev: Option<Sha256Hex> = match &stored_prev_hex {
                Some(h) => Some(h.parse().map_err(|_| DbError::Corrupt("audit prev_hash"))?),
                None => None,
            };
            let stored_entry: Sha256Hex = stored_entry_hex
                .parse()
                .map_err(|_| DbError::Corrupt("audit entry_hash"))?;

            // Linkage: this row's prev_hash must point at the previous row's
            // entry_hash (None only at the head).
            let link_ok = match (&prev, &stored_prev) {
                (None, None) => true,
                (Some(expected), Some(claimed)) => expected == claimed,
                _ => false,
            };
            if !link_ok {
                return Ok(AuditChainStatus::Broken { at_index: i });
            }

            // Recompute from this row's fields + its own prev_hash.
            let canonical = canonical(&CanonicalFields {
                id: &id,
                created_at: &created_s,
                actor_id: actor_id.as_deref(),
                action: &act,
                target_kind: target_kind.as_deref(),
                target_id: target_id.as_deref(),
                ip_address: ip_address.as_deref(),
                metadata: metadata.as_deref(),
            });
            if entry_hash(stored_prev.as_ref(), &canonical) != stored_entry {
                return Ok(AuditChainStatus::Broken { at_index: i });
            }

            prev = Some(stored_entry);
        }

        Ok(AuditChainStatus::Intact)
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
        let sql = self.db.sql(&sql);
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
            sqlx::query(&self.db.sql(
                "SELECT id, created_at, actor_id, actor_username, action, \
                 target_kind, target_id, target_name, ip_address, metadata \
                 FROM audit_log WHERE created_at < ? ORDER BY created_at DESC LIMIT ?",
            ))
            .bind(before)
            .bind(limit.clamp(1, 500))
            .fetch_all(self.db.pool())
            .await?
        } else {
            sqlx::query(&self.db.sql(
                "SELECT id, created_at, actor_id, actor_username, action, \
                 target_kind, target_id, target_name, ip_address, metadata \
                 FROM audit_log ORDER BY created_at DESC LIMIT ?",
            ))
            .bind(limit.clamp(1, 500))
            .fetch_all(self.db.pool())
            .await?
        };
        rows.iter().map(row_to_event).collect()
    }
}

/// Deterministic byte serialization of an audit event's **stable** fields — the
/// `canonical` preimage fed to [`dochub_crypto::entry_hash`].
///
/// Fields, in this exact fixed order: `id`, `created_at` (the stored RFC-3339
/// UTC string), `actor_id`, `action`, `target_kind`, `target_id`, `ip_address`,
/// `metadata`. Deliberately **excluded**: the denormalized display strings
/// `actor_username` / `target_name`, which can legitimately change without the
/// event's meaning changing.
///
/// Each field is length-prefixed so field boundaries are unforgeable even when
/// a value is empty or contains the separator byte:
///
/// ```text
/// canonical  = F(id) ‖ F(created_at) ‖ F(actor_id) ‖ F(action)
///            ‖ F(target_kind) ‖ F(target_id) ‖ F(ip_address) ‖ F(metadata)
/// F(None)    = 0x00
/// F(Some(s)) = 0x01 ‖ be_u64(len(utf8(s))) ‖ utf8(s)
/// ```
#[derive(Debug)]
struct CanonicalFields<'a> {
    id: &'a str,
    created_at: &'a str,
    actor_id: Option<&'a str>,
    action: &'a str,
    target_kind: Option<&'a str>,
    target_id: Option<&'a str>,
    ip_address: Option<&'a str>,
    metadata: Option<&'a str>,
}

fn canonical(f: &CanonicalFields) -> Vec<u8> {
    let mut buf = Vec::new();
    push_field(&mut buf, Some(f.id));
    push_field(&mut buf, Some(f.created_at));
    push_field(&mut buf, f.actor_id);
    push_field(&mut buf, Some(f.action));
    push_field(&mut buf, f.target_kind);
    push_field(&mut buf, f.target_id);
    push_field(&mut buf, f.ip_address);
    push_field(&mut buf, f.metadata);
    buf
}

/// Append one length-prefixed field to the canonical preimage. `None` is a lone
/// `0x00`; `Some(s)` is `0x01`, the big-endian u64 UTF-8 byte length, then the
/// bytes — so `None`, `Some("")`, and any content are mutually unambiguous.
fn push_field(buf: &mut Vec<u8>, field: Option<&str>) {
    match field {
        None => buf.push(0x00),
        Some(s) => {
            buf.push(0x01);
            buf.extend_from_slice(&(s.len() as u64).to_be_bytes());
            buf.extend_from_slice(s.as_bytes());
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    async fn fresh_db() -> Db {
        Db::connect("sqlite::memory:").await.expect("connect")
    }

    fn event(action: &str) -> NewAuditEvent {
        NewAuditEvent {
            actor_id: Some("u_actor".into()),
            actor_username: Some("actor".into()),
            action: action.into(),
            target_kind: Some("file".into()),
            target_id: Some("F_1".into()),
            target_name: Some("Q3.xlsx".into()),
            ip_address: Some("10.0.0.1".into()),
            metadata: Some(r#"{"k":"v"}"#.into()),
        }
    }

    #[tokio::test]
    async fn empty_chain_is_intact() {
        let db = fresh_db().await;
        let repo = AuditRepo::new(&db);
        assert_eq!(
            repo.verify_audit_chain().await.expect("verify"),
            AuditChainStatus::Intact
        );
    }

    #[tokio::test]
    async fn single_entry_chain_is_intact() {
        let db = fresh_db().await;
        let repo = AuditRepo::new(&db);
        repo.insert(event(action::VERSION_COMMIT))
            .await
            .expect("insert");
        assert_eq!(
            repo.verify_audit_chain().await.expect("verify"),
            AuditChainStatus::Intact
        );
    }

    #[tokio::test]
    async fn appends_chain_and_link_prev_to_entry() {
        let db = fresh_db().await;
        let repo = AuditRepo::new(&db);

        for i in 0..8 {
            // Distinct actions from the Phase-0 vocabulary + a legacy literal.
            let a = if i % 2 == 0 {
                action::VERSION_COMMIT
            } else {
                "auth.sign_in"
            };
            repo.insert(event(a)).await.expect("insert");
        }

        // Read the chain in append order and assert prev_hash links.
        let rows = sqlx::query(&db.sql(
            "SELECT prev_hash, entry_hash FROM audit_log \
             ORDER BY created_at ASC, id ASC",
        ))
        .fetch_all(db.pool())
        .await
        .expect("rows");
        assert_eq!(rows.len(), 8);

        let mut prev: Option<String> = None;
        for row in &rows {
            let ph: Option<String> = row.get("prev_hash");
            let eh: String = row.get("entry_hash");
            assert_eq!(ph, prev, "each prev_hash equals the prior entry_hash");
            prev = Some(eh);
        }

        assert_eq!(
            repo.verify_audit_chain().await.expect("verify"),
            AuditChainStatus::Intact
        );
    }

    #[tokio::test]
    async fn tampered_field_breaks_at_that_row() {
        let db = fresh_db().await;
        let repo = AuditRepo::new(&db);
        for _ in 0..5 {
            repo.insert(event(action::FILE_TOMBSTONE))
                .await
                .expect("insert");
        }

        // The id of the 3rd row (index 2) in chain order.
        let ordered =
            sqlx::query(&db.sql("SELECT id FROM audit_log ORDER BY created_at ASC, id ASC"))
                .fetch_all(db.pool())
                .await
                .expect("ids");
        let victim: String = ordered[2].get("id");

        // Simulate tampering a committed row's field (never done in real code).
        sqlx::query(&db.sql("UPDATE audit_log SET action = ? WHERE id = ?"))
            .bind("tampered.action")
            .bind(&victim)
            .execute(db.pool())
            .await
            .expect("tamper");

        assert_eq!(
            repo.verify_audit_chain().await.expect("verify"),
            AuditChainStatus::Broken { at_index: 2 }
        );
    }

    #[tokio::test]
    async fn tampered_metadata_breaks_at_that_row() {
        let db = fresh_db().await;
        let repo = AuditRepo::new(&db);
        for _ in 0..3 {
            repo.insert(event(action::INGEST_REJECT))
                .await
                .expect("insert");
        }
        let ordered =
            sqlx::query(&db.sql("SELECT id FROM audit_log ORDER BY created_at ASC, id ASC"))
                .fetch_all(db.pool())
                .await
                .expect("ids");
        let victim: String = ordered[0].get("id");

        sqlx::query(&db.sql("UPDATE audit_log SET metadata = ? WHERE id = ?"))
            .bind(r#"{"k":"tampered"}"#)
            .bind(&victim)
            .execute(db.pool())
            .await
            .expect("tamper");

        assert_eq!(
            repo.verify_audit_chain().await.expect("verify"),
            AuditChainStatus::Broken { at_index: 0 }
        );
    }

    #[tokio::test]
    async fn canonical_is_length_prefixed_unambiguous() {
        // None, Some(""), and content never collide across the field boundary.
        let base = CanonicalFields {
            id: "id",
            created_at: "t",
            actor_id: None,
            action: "act",
            target_kind: None,
            target_id: None,
            ip_address: None,
            metadata: None,
        };
        let a = canonical(&base);
        let b = canonical(&CanonicalFields {
            actor_id: Some(""),
            ..base
        });
        assert_ne!(a, b);
    }
}
