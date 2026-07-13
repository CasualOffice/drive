//! `AuthSession` — the axum extractor that pulls a session id from the cookie
//! and verifies it against the DB.

use axum::{
    extract::{FromRef, FromRequestParts},
    http::{header, request::Parts},
};
use dochub_db::{ApiTokenRepo, SessionRepo, UserRepo};

use crate::{handlers::cookie_name, state::AuthState, token::hash_api_token, AuthError};

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

/// How a request authenticated.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthVia {
    /// Browser session cookie.
    Session,
    /// Bearer personal access token (headless agent).
    ApiToken,
}

/// A validated principal from *either* a session cookie or a bearer API token.
///
/// Endpoints that headless agents must reach (the MCP endpoint) take this
/// instead of [`AuthSession`], so an agent can present
/// `Authorization: Bearer <token>` while a browser keeps using its cookie. A
/// present-but-invalid bearer is rejected outright (no silent cookie fallback),
/// so a bad token never masquerades as an anonymous request.
#[derive(Debug, Clone)]
pub struct AuthIdentity {
    pub user_id: String,
    pub username: String,
    pub is_admin: bool,
    pub via: AuthVia,
}

impl<S> FromRequestParts<S> for AuthIdentity
where
    AuthState: axum::extract::FromRef<S>,
    S: Send + Sync,
{
    type Rejection = AuthError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        // A bearer token, when present, is authoritative — don't fall back to
        // the cookie if it fails to validate.
        if let Some(token) = bearer_token(&parts.headers) {
            let auth_state = AuthState::from_ref(state);
            let now = time::OffsetDateTime::now_utc();
            let tokens = ApiTokenRepo::new(&auth_state.db);
            let active = tokens
                .find_active_by_hash(&hash_api_token(&token), now)
                .await
                .map_err(|_| AuthError::Unauthenticated)?
                .ok_or(AuthError::Unauthenticated)?;

            let user = UserRepo::new(&auth_state.db)
                .find_by_id(&active.user_id)
                .await
                .map_err(|_| AuthError::Unauthenticated)?;

            // Best-effort usage stamp; never fail the request on a write error.
            let _ = tokens.touch_last_used(&active.id, now).await;

            return Ok(Self {
                user_id: user.id,
                username: user.username,
                is_admin: user.is_admin,
                via: AuthVia::ApiToken,
            });
        }

        // No bearer — require a valid session cookie.
        let session = AuthSession::from_request_parts(parts, state).await?;
        Ok(Self {
            user_id: session.user_id,
            username: session.username,
            is_admin: session.is_admin,
            via: AuthVia::Session,
        })
    }
}

/// Pull a bearer token from the `Authorization` header (`Bearer <token>`,
/// scheme case-insensitive). `None` when absent or empty.
fn bearer_token(headers: &axum::http::HeaderMap) -> Option<String> {
    let value = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let rest = value
        .strip_prefix("Bearer ")
        .or_else(|| value.strip_prefix("bearer "))?;
    let token = rest.trim();
    (!token.is_empty()).then(|| token.to_string())
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
