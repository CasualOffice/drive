//! Append-only, hash-chained version history for a file (build spec §5).
//!
//! [`FileVersionsRepo`] is the raw table access over `file_versions`. It only
//! ever *appends* a row and reads back — there is deliberately no update or
//! delete: a committed version is immutable (CLAUDE.md inviolable rule 6). The
//! crypto (sealing bytes, computing `content_hash`, verifying the chain) lives
//! one layer up in [`crate::registry`]; this module is pure persistence.

use sqlx::Row;

use crate::{
    users::{parse_ts, ts},
    Db, DbError,
};

/// One committed version row. `seq` is 1-based and monotone per `file_id`;
/// `content_hash` is the lowercase-hex SHA-256 of the sealed (cipher)bytes and
/// `prev_hash` points at the prior version's `content_hash` (`None` at seq=1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Version {
    pub file_id: String,
    pub seq: i64,
    pub storage_key: String,
    pub size: i64,
    pub content_hash: String,
    pub prev_hash: Option<String>,
    pub author_id: String,
    pub reason: Option<String>,
    pub created_at: time::OffsetDateTime,
}

/// The fields a caller supplies to append a version. `seq`, `prev_hash`, and
/// the `content_hash`/`storage_key` are all computed by [`crate::registry`]
/// before the row is appended — this struct just carries them to the INSERT.
#[derive(Debug, Clone)]
pub struct NewVersion {
    pub file_id: String,
    pub seq: i64,
    pub storage_key: String,
    pub size: i64,
    pub content_hash: String,
    pub prev_hash: Option<String>,
    pub author_id: String,
    pub reason: Option<String>,
}

/// Append-only access to `file_versions`. No update/delete methods exist by
/// design — the only mutation is [`FileVersionsRepo::append`].
#[derive(Debug, Clone)]
pub struct FileVersionsRepo<'a> {
    db: &'a Db,
}

impl<'a> FileVersionsRepo<'a> {
    #[must_use]
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    /// Append a version row. Fails (unique violation on `(file_id, seq)`) if a
    /// row with the same `seq` already exists — seq is never reused.
    pub async fn append(&self, new: &NewVersion) -> Result<Version, DbError> {
        let created = time::OffsetDateTime::now_utc();
        let created_s = ts(created);
        sqlx::query(
            "INSERT INTO file_versions \
             (file_id, seq, storage_key, size, content_hash, prev_hash, \
              author_id, reason, created_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&new.file_id)
        .bind(new.seq)
        .bind(&new.storage_key)
        .bind(new.size)
        .bind(&new.content_hash)
        .bind(&new.prev_hash)
        .bind(&new.author_id)
        .bind(&new.reason)
        .bind(&created_s)
        .execute(self.db.pool())
        .await?;

        Ok(Version {
            file_id: new.file_id.clone(),
            seq: new.seq,
            storage_key: new.storage_key.clone(),
            size: new.size,
            content_hash: new.content_hash.clone(),
            prev_hash: new.prev_hash.clone(),
            author_id: new.author_id.clone(),
            reason: new.reason.clone(),
            created_at: created,
        })
    }

    /// The current head (highest `seq`) for a file, or `None` if it has no
    /// committed versions yet (a pre-existing file with no history).
    pub async fn head(&self, file_id: &str) -> Result<Option<Version>, DbError> {
        let row = sqlx::query(
            "SELECT file_id, seq, storage_key, size, content_hash, prev_hash, \
             author_id, reason, created_at \
             FROM file_versions WHERE file_id = ? ORDER BY seq DESC LIMIT 1",
        )
        .bind(file_id)
        .fetch_optional(self.db.pool())
        .await?;
        row.map(row_to_version).transpose()
    }

    /// The full chain for a file, ordered by `seq` ascending (seq=1 first) —
    /// the order [`crate::registry::Registry::verify_chain`] walks.
    pub async fn list_chain(&self, file_id: &str) -> Result<Vec<Version>, DbError> {
        let rows = sqlx::query(
            "SELECT file_id, seq, storage_key, size, content_hash, prev_hash, \
             author_id, reason, created_at \
             FROM file_versions WHERE file_id = ? ORDER BY seq ASC",
        )
        .bind(file_id)
        .fetch_all(self.db.pool())
        .await?;
        rows.into_iter().map(row_to_version).collect()
    }

    /// A specific version by `(file_id, seq)`, or `None` if it doesn't exist.
    pub async fn get(&self, file_id: &str, seq: i64) -> Result<Option<Version>, DbError> {
        let row = sqlx::query(
            "SELECT file_id, seq, storage_key, size, content_hash, prev_hash, \
             author_id, reason, created_at \
             FROM file_versions WHERE file_id = ? AND seq = ?",
        )
        .bind(file_id)
        .bind(seq)
        .fetch_optional(self.db.pool())
        .await?;
        row.map(row_to_version).transpose()
    }
}

fn row_to_version(row: sqlx::any::AnyRow) -> Result<Version, DbError> {
    Ok(Version {
        file_id: row.get("file_id"),
        seq: row.get::<i64, _>("seq"),
        storage_key: row.get("storage_key"),
        size: row.get::<i64, _>("size"),
        content_hash: row.get("content_hash"),
        prev_hash: row.try_get::<Option<String>, _>("prev_hash").ok().flatten(),
        author_id: row.get("author_id"),
        reason: row.try_get::<Option<String>, _>("reason").ok().flatten(),
        created_at: parse_ts(row.get::<String, _>("created_at"))?,
    })
}
