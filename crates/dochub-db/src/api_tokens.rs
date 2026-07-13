//! API tokens (personal access tokens) — bearer credentials for headless
//! agents to authenticate to the MCP endpoint without a browser session.
//!
//! Only the SHA-256 hash of a token is stored (the plaintext is shown once at
//! creation); authentication hashes the presented bearer and looks it up by
//! exact match. Revocation is a tombstone (`revoked_at`), never a delete, so the
//! record of issued credentials survives. The token hash is computed in
//! `dochub-auth` (which owns the crypto deps); this repo only persists strings.

use sqlx::Row;

use crate::{
    users::{parse_ts, ts},
    Db, DbError,
};

/// A stored API token. Never carries the token hash out of the repo — callers
/// list metadata only.
#[derive(Debug, Clone)]
pub struct ApiToken {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub created_at: time::OffsetDateTime,
    pub expires_at: Option<time::OffsetDateTime>,
    pub last_used_at: Option<time::OffsetDateTime>,
    pub revoked_at: Option<time::OffsetDateTime>,
}

impl ApiToken {
    /// Active = not revoked and not past its expiry (if any).
    #[must_use]
    pub fn is_active(&self, now: time::OffsetDateTime) -> bool {
        self.revoked_at.is_none() && self.expires_at.is_none_or(|e| e > now)
    }
}

/// Fields for minting a token row. `token_hash` is the SHA-256 hex of the
/// plaintext (computed by the caller); the plaintext is never passed here.
#[derive(Debug, Clone)]
pub struct NewApiToken {
    pub user_id: String,
    pub name: String,
    pub token_hash: String,
    pub expires_at: Option<time::OffsetDateTime>,
}

#[derive(Debug, Clone)]
pub struct ApiTokenRepo<'a> {
    db: &'a Db,
}

impl<'a> ApiTokenRepo<'a> {
    #[must_use]
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    /// Insert a new token row, returning its metadata (the caller already holds
    /// the plaintext to show once).
    pub async fn insert(&self, new: &NewApiToken) -> Result<ApiToken, DbError> {
        let id = ulid::Ulid::new().to_string();
        let now = time::OffsetDateTime::now_utc();
        sqlx::query(&self.db.sql(
            "INSERT INTO api_tokens (id, user_id, name, token_hash, created_at, expires_at) \
             VALUES (?, ?, ?, ?, ?, ?)",
        ))
        .bind(&id)
        .bind(&new.user_id)
        .bind(&new.name)
        .bind(&new.token_hash)
        .bind(ts(now))
        .bind(new.expires_at.map(ts))
        .execute(self.db.pool())
        .await?;
        Ok(ApiToken {
            id,
            user_id: new.user_id.clone(),
            name: new.name.clone(),
            created_at: now,
            expires_at: new.expires_at,
            last_used_at: None,
            revoked_at: None,
        })
    }

    /// Resolve a presented token by its hash, returning it only when active
    /// (not revoked, not expired). `None` for unknown/revoked/expired hashes —
    /// the caller treats all three identically as an auth failure.
    pub async fn find_active_by_hash(
        &self,
        token_hash: &str,
        now: time::OffsetDateTime,
    ) -> Result<Option<ApiToken>, DbError> {
        let row = sqlx::query(&self.db.sql(
            "SELECT id, user_id, name, created_at, expires_at, last_used_at, revoked_at \
             FROM api_tokens WHERE token_hash = ?",
        ))
        .bind(token_hash)
        .fetch_optional(self.db.pool())
        .await?;
        let Some(row) = row else { return Ok(None) };
        let token = row_to_token(&row)?;
        Ok(token.is_active(now).then_some(token))
    }

    /// List a user's tokens, newest first. Metadata only — no hashes. Includes
    /// revoked/expired rows so the UI can show history.
    pub async fn list_for_user(&self, user_id: &str) -> Result<Vec<ApiToken>, DbError> {
        let rows = sqlx::query(&self.db.sql(
            "SELECT id, user_id, name, created_at, expires_at, last_used_at, revoked_at \
             FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC, id DESC",
        ))
        .bind(user_id)
        .fetch_all(self.db.pool())
        .await?;
        rows.iter().map(row_to_token).collect()
    }

    /// Stamp a token's `last_used_at`. Best-effort observability; callers may
    /// ignore the result.
    pub async fn touch_last_used(
        &self,
        id: &str,
        now: time::OffsetDateTime,
    ) -> Result<(), DbError> {
        sqlx::query(
            &self
                .db
                .sql("UPDATE api_tokens SET last_used_at = ? WHERE id = ?"),
        )
        .bind(ts(now))
        .bind(id)
        .execute(self.db.pool())
        .await?;
        Ok(())
    }

    /// Revoke a token (tombstone). Scoped to `user_id` so one user can't revoke
    /// another's. Returns true if a still-active row was revoked.
    pub async fn revoke(&self, id: &str, user_id: &str) -> Result<bool, DbError> {
        let res = sqlx::query(&self.db.sql(
            "UPDATE api_tokens SET revoked_at = ? \
             WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
        ))
        .bind(ts(time::OffsetDateTime::now_utc()))
        .bind(id)
        .bind(user_id)
        .execute(self.db.pool())
        .await?;
        Ok(res.rows_affected() > 0)
    }
}

fn row_to_token(row: &sqlx::any::AnyRow) -> Result<ApiToken, DbError> {
    let opt_ts = |col: &str| -> Result<Option<time::OffsetDateTime>, DbError> {
        match row.get::<Option<String>, _>(col) {
            Some(s) => parse_ts(s).map(Some),
            None => Ok(None),
        }
    };
    Ok(ApiToken {
        id: row.get("id"),
        user_id: row.get("user_id"),
        name: row.get("name"),
        created_at: parse_ts(row.get("created_at"))?,
        expires_at: opt_ts("expires_at")?,
        last_used_at: opt_ts("last_used_at")?,
        revoked_at: opt_ts("revoked_at")?,
    })
}
