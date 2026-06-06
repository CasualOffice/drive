//! `AuthState` — what auth handlers need.

use drive_db::Db;

#[derive(Debug, Clone)]
pub struct AuthState {
    pub db: Db,
    /// Whether to set `Secure` on cookies. False only in unencrypted dev.
    pub cookie_secure: bool,
    /// Session TTL.
    pub session_ttl: time::Duration,
}

impl AuthState {
    #[must_use]
    pub fn new(db: Db, cookie_secure: bool, session_ttl: time::Duration) -> Self {
        Self {
            db,
            cookie_secure,
            session_ttl,
        }
    }
}
