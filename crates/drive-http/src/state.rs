//! Shared HTTP layer state. Cheap to clone — everything is `Arc` internally.

use std::sync::Arc;

use axum::extract::FromRef;
use drive_auth::AuthState;
use drive_core::Config;
use drive_db::Db;
use drive_storage::Storage;
use drive_wopi::WopiState;

#[derive(Clone)]
pub struct HttpState {
    pub storage: Storage,
    pub wopi: WopiState,
    pub db: Db,
    pub auth: AuthState,
    pub jwt_secret: Arc<[u8; 32]>,
    pub config: Arc<Config>,
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
