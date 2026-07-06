//! Auth router fragment. Mounted at `/api/auth` + `/api/setup` by `dochub-http`.

use axum::{
    routing::{get, post},
    Router,
};

use crate::{
    handlers::{change_password, setup_admin, setup_status, sign_in, sign_out},
    state::AuthState,
};

pub fn router(state: AuthState) -> Router {
    Router::new()
        .route("/api/auth/sign-in", post(sign_in))
        .route("/api/auth/sign-out", post(sign_out))
        .route("/api/auth/change-password", post(change_password))
        // Setup wizard. Public — protected by the zero-users invariant rather
        // than auth. Once a user exists, both routes 409 forever.
        .route("/api/setup/status", get(setup_status))
        .route("/api/setup/admin", post(setup_admin))
        .with_state(state)
}
