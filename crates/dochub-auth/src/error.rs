use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AuthError {
    #[error("missing or invalid credentials")]
    InvalidCredentials,
    #[error("unauthenticated")]
    Unauthenticated,
    #[error("rate limited")]
    RateLimited,
    #[error("password policy: {0}")]
    PasswordPolicy(&'static str),
    #[error("setup already complete")]
    AlreadyInitialized,
    /// Phase 3 §12 — `DOCHUB_ALLOW_PASSWORD_AUTH=false` shut this path off.
    /// Surfaces as 404 to keep parity with "endpoint doesn't exist" so
    /// scrapers can't tell the difference between a hidden path and an
    /// unsupported one.
    #[error("password auth disabled on this Drive")]
    PasswordAuthDisabled,
    #[error("internal: {0}")]
    Internal(String),
}

#[derive(Serialize)]
struct ErrBody<'a> {
    error: &'a str,
}

impl IntoResponse for AuthError {
    fn into_response(self) -> Response {
        let (status, msg) = match self {
            // Per OWASP: do not differentiate "wrong password" from "no such
            // user". Same response, same code, same wording.
            Self::InvalidCredentials => (StatusCode::UNAUTHORIZED, "invalid credentials"),
            Self::Unauthenticated => (StatusCode::UNAUTHORIZED, "unauthenticated"),
            Self::RateLimited => (StatusCode::TOO_MANY_REQUESTS, "rate limited"),
            Self::PasswordPolicy(reason) => (StatusCode::UNPROCESSABLE_ENTITY, reason),
            Self::AlreadyInitialized => (StatusCode::CONFLICT, "setup already complete"),
            Self::PasswordAuthDisabled => (StatusCode::NOT_FOUND, "not found"),
            Self::Internal(_) => (StatusCode::INTERNAL_SERVER_ERROR, "internal error"),
        };
        (status, Json(ErrBody { error: msg })).into_response()
    }
}
