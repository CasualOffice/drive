//! Short-lived OIDC sign-in flow state. Phase 3 §12.
//! Spec: docs/research/12-oidc.md.
//!
//! Rows live for ~10 min between the `/login` redirect and the
//! `/callback` exchange. Older rows are swept by the same hourly
//! janitor that handles `sessions::delete_expired`.

use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::{
    users::{parse_ts, ts},
    Db, DbError,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OidcFlowState {
    pub state: String,
    pub pkce_verifier: String,
    pub nonce: String,
    pub created_at: time::OffsetDateTime,
    pub expires_at: time::OffsetDateTime,
}

#[derive(Debug, Clone)]
pub struct NewOidcFlowState {
    pub state: String,
    pub pkce_verifier: String,
    pub nonce: String,
    pub ttl: time::Duration,
}

#[derive(Debug, Clone)]
pub struct OidcFlowStateRepo<'a> {
    db: &'a Db,
}

impl<'a> OidcFlowStateRepo<'a> {
    #[must_use]
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    pub async fn insert(&self, new: &NewOidcFlowState) -> Result<OidcFlowState, DbError> {
        let now = time::OffsetDateTime::now_utc();
        let expires = now + new.ttl;
        sqlx::query(
            "INSERT INTO oidc_flow_state (state, pkce_verifier, nonce, created_at, expires_at) \
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&new.state)
        .bind(&new.pkce_verifier)
        .bind(&new.nonce)
        .bind(ts(now))
        .bind(ts(expires))
        .execute(self.db.pool())
        .await?;
        Ok(OidcFlowState {
            state: new.state.clone(),
            pkce_verifier: new.pkce_verifier.clone(),
            nonce: new.nonce.clone(),
            created_at: now,
            expires_at: expires,
        })
    }

    /// Look up by state token. Returns `NotFound` if no row OR if the
    /// row has expired (we treat expired rows as gone — they may still
    /// be in the table until the next sweep, but they're no longer
    /// usable).
    pub async fn take(&self, state: &str) -> Result<OidcFlowState, DbError> {
        let row = sqlx::query(
            "SELECT state, pkce_verifier, nonce, created_at, expires_at \
             FROM oidc_flow_state WHERE state = ?",
        )
        .bind(state)
        .fetch_optional(self.db.pool())
        .await?
        .ok_or(DbError::NotFound)?;
        let now = time::OffsetDateTime::now_utc();
        let expires_at = parse_ts(row.get::<String, _>("expires_at"))?;
        if expires_at < now {
            // Best-effort delete + treat as gone.
            let _ = sqlx::query("DELETE FROM oidc_flow_state WHERE state = ?")
                .bind(state)
                .execute(self.db.pool())
                .await;
            return Err(DbError::NotFound);
        }
        // Single-use — delete on read so a code-reuse attack against a
        // captured `state` fails the second time.
        sqlx::query("DELETE FROM oidc_flow_state WHERE state = ?")
            .bind(state)
            .execute(self.db.pool())
            .await?;
        Ok(OidcFlowState {
            state: row.get("state"),
            pkce_verifier: row.get("pkce_verifier"),
            nonce: row.get("nonce"),
            created_at: parse_ts(row.get::<String, _>("created_at"))?,
            expires_at,
        })
    }

    /// Janitor — sweeps expired rows. Returns the count removed.
    pub async fn delete_expired(&self) -> Result<u64, DbError> {
        let res = sqlx::query("DELETE FROM oidc_flow_state WHERE expires_at < ?")
            .bind(ts(time::OffsetDateTime::now_utc()))
            .execute(self.db.pool())
            .await?;
        Ok(res.rows_affected())
    }
}
