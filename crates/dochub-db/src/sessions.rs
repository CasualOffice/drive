//! Sessions table — server-side session store. The cookie carries only the
//! session id; CSRF token + expiry live here.

use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::{
    users::{parse_ts, ts},
    Db, DbError,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub user_id: String,
    pub csrf_token: String,
    pub expires_at: time::OffsetDateTime,
    pub created_at: time::OffsetDateTime,
}

impl Session {
    #[must_use]
    pub fn is_expired(&self) -> bool {
        self.expires_at < time::OffsetDateTime::now_utc()
    }
}

#[derive(Debug, Clone)]
pub struct NewSession {
    pub user_id: String,
    pub csrf_token: String,
    pub ttl: time::Duration,
}

#[derive(Debug, Clone)]
pub struct SessionRepo<'a> {
    db: &'a Db,
}

impl<'a> SessionRepo<'a> {
    #[must_use]
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    pub async fn insert(&self, id: &str, new: &NewSession) -> Result<Session, DbError> {
        let now = time::OffsetDateTime::now_utc();
        let exp = now + new.ttl;
        sqlx::query(
            "INSERT INTO sessions (id, user_id, csrf_token, expires_at, created_at) \
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(&new.user_id)
        .bind(&new.csrf_token)
        .bind(ts(exp))
        .bind(ts(now))
        .execute(self.db.pool())
        .await?;
        Ok(Session {
            id: id.to_string(),
            user_id: new.user_id.clone(),
            csrf_token: new.csrf_token.clone(),
            expires_at: exp,
            created_at: now,
        })
    }

    pub async fn get(&self, id: &str) -> Result<Session, DbError> {
        let row = sqlx::query(
            "SELECT id, user_id, csrf_token, expires_at, created_at \
             FROM sessions WHERE id = ?",
        )
        .bind(id)
        .fetch_one(self.db.pool())
        .await
        .map_err(DbError::from_sqlx_no_rows)?;
        Ok(Session {
            id: row.get("id"),
            user_id: row.get("user_id"),
            csrf_token: row.get("csrf_token"),
            expires_at: parse_ts(row.get("expires_at"))?,
            created_at: parse_ts(row.get("created_at"))?,
        })
    }

    pub async fn delete(&self, id: &str) -> Result<(), DbError> {
        sqlx::query("DELETE FROM sessions WHERE id = ?")
            .bind(id)
            .execute(self.db.pool())
            .await?;
        Ok(())
    }

    pub async fn delete_expired(&self) -> Result<u64, DbError> {
        let res = sqlx::query("DELETE FROM sessions WHERE expires_at < ?")
            .bind(ts(time::OffsetDateTime::now_utc()))
            .execute(self.db.pool())
            .await?;
        Ok(res.rows_affected())
    }

    /// Count non-expired sessions. Drives the Admin → Sessions card.
    pub async fn count_active(&self) -> Result<i64, DbError> {
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE expires_at >= ?")
            .bind(ts(time::OffsetDateTime::now_utc()))
            .fetch_one(self.db.pool())
            .await?;
        Ok(n)
    }

    /// Drop every session for `user_id` *except* one — used on password
    /// change to invalidate other devices while keeping the caller signed in.
    pub async fn delete_for_user_except(
        &self,
        user_id: &str,
        keep_session_id: &str,
    ) -> Result<u64, DbError> {
        let res = sqlx::query("DELETE FROM sessions WHERE user_id = ? AND id <> ?")
            .bind(user_id)
            .bind(keep_session_id)
            .execute(self.db.pool())
            .await?;
        Ok(res.rows_affected())
    }
}
