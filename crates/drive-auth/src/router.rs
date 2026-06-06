//! Auth router fragment. Mounted at `/api/auth` by `drive-http`.

use axum::{routing::post, Router};

use crate::{
    handlers::{sign_in, sign_out},
    state::AuthState,
};

pub fn router(state: AuthState) -> Router {
    Router::new()
        .route("/api/auth/sign-in", post(sign_in))
        .route("/api/auth/sign-out", post(sign_out))
        .with_state(state)
}
