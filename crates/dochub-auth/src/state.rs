//! `AuthState` — what auth handlers need.

use dochub_db::Db;

#[derive(Debug, Clone)]
pub struct AuthState {
    pub db: Db,
    /// Whether to set `Secure` on cookies. False only in unencrypted dev.
    pub cookie_secure: bool,
    /// Session TTL.
    pub session_ttl: time::Duration,
    /// Phase 3 §12 — when false, `/api/auth/sign-in` returns 404 so the
    /// password path is hidden server-side, not just CSS'd away. Default
    /// `true` so deployments without OIDC keep working.
    pub allow_password_auth: bool,
}

impl AuthState {
    #[must_use]
    pub fn new(db: Db, cookie_secure: bool, session_ttl: time::Duration) -> Self {
        Self {
            db,
            cookie_secure,
            session_ttl,
            allow_password_auth: true,
        }
    }

    /// Builder helper for the production wiring in dochub-bin.
    #[must_use]
    pub fn with_password_auth(mut self, allow: bool) -> Self {
        self.allow_password_auth = allow;
        self
    }
}
