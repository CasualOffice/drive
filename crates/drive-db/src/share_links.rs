//! Share-links table — public access tokens for individual files (and,
//! later, folders). The table schema ships in the initial migration; this
//! repository wires it up.
//!
//! Anti-enumeration: the only public query is `find_by_token`, which uses
//! the `share_links_token_idx` index. Tokens are minted as 16 random bytes
//! → URL-safe base64 (22 chars) and compared via `find_by_token`'s exact
//! WHERE clause — no LIKE / prefix lookups.

use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::{
    users::{parse_ts, ts},
    Db, DbError,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareLink {
    pub id: String,
    pub token: String,
    pub file_id: Option<String>,
    pub folder_id: Option<String>,
    pub password_hash: Option<String>,
    /// "view" or "edit" (v0 only ships "view"; reserved for v0.2).
    pub permissions: String,
    pub expires_at: Option<time::OffsetDateTime>,
    pub created_at: time::OffsetDateTime,
    pub created_by: String,
    pub last_accessed_at: Option<time::OffsetDateTime>,
    pub access_count: i64,
}

impl ShareLink {
    #[must_use]
    pub fn is_expired(&self) -> bool {
        self.expires_at
            .is_some_and(|t| t < time::OffsetDateTime::now_utc())
    }
}

#[derive(Debug, Clone)]
pub struct NewShareLink {
    pub token: String,
    pub file_id: Option<String>,
    pub folder_id: Option<String>,
    pub password_hash: Option<String>,
    pub permissions: String,
    pub expires_at: Option<time::OffsetDateTime>,
    pub created_by: String,
}

#[derive(Debug, Clone)]
pub struct ShareLinkRepo<'a> {
    db: &'a Db,
}

impl<'a> ShareLinkRepo<'a> {
    #[must_use]
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    pub async fn insert(&self, new: &NewShareLink) -> Result<ShareLink, DbError> {
        let id = ulid::Ulid::new().to_string();
        let created_at = time::OffsetDateTime::now_utc();
        sqlx::query(
            "INSERT INTO share_links \
             (id, token, file_id, folder_id, password_hash, permissions, expires_at, \
              created_at, created_by, access_count) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
        )
        .bind(&id)
        .bind(&new.token)
        .bind(&new.file_id)
        .bind(&new.folder_id)
        .bind(&new.password_hash)
        .bind(&new.permissions)
        .bind(new.expires_at.map(ts))
        .bind(ts(created_at))
        .bind(&new.created_by)
        .execute(self.db.pool())
        .await?;

        Ok(ShareLink {
            id,
            token: new.token.clone(),
            file_id: new.file_id.clone(),
            folder_id: new.folder_id.clone(),
            password_hash: new.password_hash.clone(),
            permissions: new.permissions.clone(),
            expires_at: new.expires_at,
            created_at,
            created_by: new.created_by.clone(),
            last_accessed_at: None,
            access_count: 0,
        })
    }

    /// Public lookup by token. Returns `NotFound` if no row.
    pub async fn find_by_token(&self, token: &str) -> Result<ShareLink, DbError> {
        let row = sqlx::query(
            "SELECT id, token, file_id, folder_id, password_hash, permissions, \
             expires_at, created_at, created_by, last_accessed_at, access_count \
             FROM share_links WHERE token = ?",
        )
        .bind(token)
        .fetch_one(self.db.pool())
        .await
        .map_err(DbError::from_sqlx_no_rows)?;
        row_to_share_link(&row)
    }

    /// All shares for a given file, newest first.
    pub async fn list_for_file(&self, file_id: &str) -> Result<Vec<ShareLink>, DbError> {
        let rows = sqlx::query(
            "SELECT id, token, file_id, folder_id, password_hash, permissions, \
             expires_at, created_at, created_by, last_accessed_at, access_count \
             FROM share_links WHERE file_id = ? ORDER BY created_at DESC",
        )
        .bind(file_id)
        .fetch_all(self.db.pool())
        .await?;
        rows.iter().map(row_to_share_link).collect()
    }

    pub async fn find_by_id(&self, id: &str) -> Result<ShareLink, DbError> {
        let row = sqlx::query(
            "SELECT id, token, file_id, folder_id, password_hash, permissions, \
             expires_at, created_at, created_by, last_accessed_at, access_count \
             FROM share_links WHERE id = ?",
        )
        .bind(id)
        .fetch_one(self.db.pool())
        .await
        .map_err(DbError::from_sqlx_no_rows)?;
        row_to_share_link(&row)
    }

    pub async fn delete(&self, id: &str) -> Result<(), DbError> {
        let res = sqlx::query("DELETE FROM share_links WHERE id = ?")
            .bind(id)
            .execute(self.db.pool())
            .await?;
        if res.rows_affected() == 0 {
            return Err(DbError::NotFound);
        }
        Ok(())
    }

    /// Bump access_count + last_accessed_at. Called after a successful
    /// recipient-side resolution; failure is non-fatal (best-effort).
    pub async fn touch(&self, id: &str) -> Result<(), DbError> {
        sqlx::query(
            "UPDATE share_links SET access_count = access_count + 1, \
             last_accessed_at = ? WHERE id = ?",
        )
        .bind(ts(time::OffsetDateTime::now_utc()))
        .bind(id)
        .execute(self.db.pool())
        .await?;
        Ok(())
    }
}

fn row_to_share_link(row: &sqlx::any::AnyRow) -> Result<ShareLink, DbError> {
    let expires_at = row
        .get::<Option<String>, _>("expires_at")
        .map(parse_ts)
        .transpose()?;
    let last_accessed_at = row
        .get::<Option<String>, _>("last_accessed_at")
        .map(parse_ts)
        .transpose()?;
    Ok(ShareLink {
        id: row.get("id"),
        token: row.get("token"),
        file_id: row.get("file_id"),
        folder_id: row.get("folder_id"),
        password_hash: row.get("password_hash"),
        permissions: row.get("permissions"),
        expires_at,
        created_at: parse_ts(row.get::<String, _>("created_at"))?,
        created_by: row.get("created_by"),
        last_accessed_at,
        access_count: row.get("access_count"),
    })
}
