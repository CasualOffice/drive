//! Users table — single-tenant v0 holds exactly one row (the admin), but the
//! shape grows directly into multi-user without a migration.

use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::{Db, DbError};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub username: String,
    pub password_hash: String,
    pub is_admin: bool,
    pub created_at: time::OffsetDateTime,
}

#[derive(Debug, Clone)]
pub struct NewUser {
    pub username: String,
    pub password_hash: String,
    pub is_admin: bool,
}

#[derive(Debug, Clone)]
pub struct UserRepo<'a> {
    db: &'a Db,
}

impl<'a> UserRepo<'a> {
    #[must_use]
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    /// Insert a new user. Returns `UniqueViolation` if the username clashes.
    pub async fn insert(&self, new: &NewUser) -> Result<User, DbError> {
        let id = ulid::Ulid::new().to_string();
        let created_at = time::OffsetDateTime::now_utc();
        let created_at_str = ts(created_at);
        let is_admin_i = i64::from(new.is_admin);

        sqlx::query(
            "INSERT INTO users (id, username, password_hash, is_admin, created_at) \
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(&new.username)
        .bind(&new.password_hash)
        .bind(is_admin_i)
        .bind(&created_at_str)
        .execute(self.db.pool())
        .await
        .map_err(map_unique_violation)?;

        Ok(User {
            id,
            username: new.username.clone(),
            password_hash: new.password_hash.clone(),
            is_admin: new.is_admin,
            created_at,
        })
    }

    /// Look up a user by username. Returns `NotFound` if no row.
    pub async fn find_by_username(&self, username: &str) -> Result<User, DbError> {
        let row = sqlx::query(
            "SELECT id, username, password_hash, is_admin, created_at \
             FROM users WHERE username = ?",
        )
        .bind(username)
        .fetch_one(self.db.pool())
        .await
        .map_err(DbError::from_sqlx_no_rows)?;
        Ok(User {
            id: row.get("id"),
            username: row.get("username"),
            password_hash: row.get("password_hash"),
            is_admin: row.get::<i64, _>("is_admin") != 0,
            created_at: parse_ts(row.get::<String, _>("created_at"))?,
        })
    }

    /// Look up a user by id. Returns `NotFound` if no row.
    pub async fn find_by_id(&self, id: &str) -> Result<User, DbError> {
        let row = sqlx::query(
            "SELECT id, username, password_hash, is_admin, created_at \
             FROM users WHERE id = ?",
        )
        .bind(id)
        .fetch_one(self.db.pool())
        .await
        .map_err(DbError::from_sqlx_no_rows)?;
        Ok(User {
            id: row.get("id"),
            username: row.get("username"),
            password_hash: row.get("password_hash"),
            is_admin: row.get::<i64, _>("is_admin") != 0,
            created_at: parse_ts(row.get::<String, _>("created_at"))?,
        })
    }

    /// Replace the stored password hash for an existing user. Returns
    /// `NotFound` if the user does not exist.
    pub async fn update_password(&self, id: &str, new_hash: &str) -> Result<(), DbError> {
        let res = sqlx::query("UPDATE users SET password_hash = ? WHERE id = ?")
            .bind(new_hash)
            .bind(id)
            .execute(self.db.pool())
            .await?;
        if res.rows_affected() == 0 {
            return Err(DbError::NotFound);
        }
        Ok(())
    }
}

fn map_unique_violation(e: sqlx::Error) -> DbError {
    if let sqlx::Error::Database(dbe) = &e {
        if dbe.is_unique_violation() {
            return DbError::UniqueViolation(dbe.message().to_string());
        }
    }
    DbError::Sqlx(e)
}

pub(crate) fn ts(t: time::OffsetDateTime) -> String {
    t.format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

pub(crate) fn parse_ts(s: String) -> Result<time::OffsetDateTime, DbError> {
    time::OffsetDateTime::parse(&s, &time::format_description::well_known::Rfc3339)
        .map_err(|e| DbError::InvalidUrl(format!("bad timestamp {s:?}: {e}")))
}
