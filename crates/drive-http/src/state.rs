//! Shared HTTP layer state. Cheap to clone — everything is `Arc` internally.

use std::{sync::Arc, time::Instant};

use axum::extract::FromRef;
use drive_auth::AuthState;
use drive_core::Config;
use drive_db::Db;
use drive_storage::Storage;
use drive_wopi::WopiState;

/// Process start instant, captured at first state construction. Drives the
/// Admin → System → Uptime readout. Static so we get "real" uptime even
/// across cheap HttpState clones in tests.
fn process_started_at() -> Instant {
    use std::sync::OnceLock;
    static STARTED: OnceLock<Instant> = OnceLock::new();
    *STARTED.get_or_init(Instant::now)
}

#[derive(Clone)]
pub struct HttpState {
    pub storage: Storage,
    pub wopi: WopiState,
    pub db: Db,
    pub auth: AuthState,
    pub jwt_secret: Arc<[u8; 32]>,
    pub config: Arc<Config>,
}

impl HttpState {
    /// Seconds since the process started. Capped at `u64`.
    #[must_use]
    pub fn uptime_seconds(&self) -> u64 {
        process_started_at().elapsed().as_secs()
    }
}

impl std::fmt::Debug for HttpState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HttpState")
            .field("storage", &self.storage)
            .field("backend", &self.config.backend)
            .field("db_backend", &self.db.backend())
            .finish_non_exhaustive()
    }
}

// `FromRef` lets the AuthSession extractor pull AuthState out of HttpState
// at request time without forcing every handler to take both.
impl FromRef<HttpState> for AuthState {
    fn from_ref(state: &HttpState) -> Self {
        state.auth.clone()
    }
}
