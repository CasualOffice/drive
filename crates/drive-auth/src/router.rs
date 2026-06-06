//! Auth router fragment. Mounted at `/api/auth` by `drive-http`.

use axum::{routing::post, Router};

use crate::{
    handlers::{change_password, sign_in, sign_out},
    state::AuthState,
};

pub fn router(state: AuthState) -> Router {
    Router::new()
        .route("/api/auth/sign-in", post(sign_in))
        .route("/api/auth/sign-out", post(sign_out))
        .route("/api/auth/change-password", post(change_password))
        .with_state(state)
}
