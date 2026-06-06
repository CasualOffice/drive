//! `AuthSession` — the axum extractor that pulls a session id from the cookie
//! and verifies it against the DB.

use axum::{
    extract::{FromRef, FromRequestParts},
    http::{header, request::Parts},
};
use drive_db::{SessionRepo, UserRepo};

use crate::{handlers::cookie_name, state::AuthState, AuthError};

/// A validated, currently-authenticated session.
#[derive(Debug, Clone)]
pub struct AuthSession {
    pub session_id: String,
    pub user_id: String,
    pub username: String,
    pub csrf_token: String,
    pub is_admin: bool,
}

/// Optional version — returns `None` for unauthenticated requests instead of
/// 401-ing. Useful for routes that work either way (share-link consumer flow).
#[derive(Debug, Clone)]
pub struct OptionalAuthSession(pub Option<AuthSession>);

impl<S> FromRequestParts<S> for AuthSession
where
    AuthState: axum::extract::FromRef<S>,
    S: Send + Sync,
{
    type Rejection = AuthError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let auth_state = AuthState::from_ref(state);
        let sid = extract_session_id(&parts.headers, auth_state.cookie_secure)
            .ok_or(AuthError::Unauthenticated)?;

        let sessions = SessionRepo::new(&auth_state.db);
        let session = sessions
            .get(&sid)
            .await
            .map_err(|_| AuthError::Unauthenticated)?;
        if session.is_expired() {
            return Err(AuthError::Unauthenticated);
        }

        let users = UserRepo::new(&auth_state.db);
        let user = users
            .find_by_id(&session.user_id)
            .await
            .map_err(|_| AuthError::Unauthenticated)?;

        Ok(Self {
            session_id: session.id,
            user_id: user.id,
            username: user.username,
            csrf_token: session.csrf_token,
            is_admin: user.is_admin,
        })
    }
}

impl<S> FromRequestParts<S> for OptionalAuthSession
where
    AuthState: axum::extract::FromRef<S>,
    S: Send + Sync,
{
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        Ok(Self(
            AuthSession::from_request_parts(parts, state).await.ok(),
        ))
    }
}

fn extract_session_id(headers: &axum::http::HeaderMap, secure: bool) -> Option<String> {
    let cookie_hdr = headers.get(header::COOKIE)?.to_str().ok()?;
    let target = cookie_name(secure);
    for piece in cookie_hdr.split(';') {
        let trimmed = piece.trim();
        if let Some(val) = trimmed.strip_prefix(&format!("{target}=")) {
            return Some(val.to_string());
        }
    }
    None
}
