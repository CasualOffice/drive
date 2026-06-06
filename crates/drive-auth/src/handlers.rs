//! Sign-in + sign-out handlers.

use axum::{
    extract::State,
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use drive_db::{DbError, NewSession, SessionRepo, UserRepo};
use serde::{Deserialize, Serialize};

use crate::{
    extractor::AuthSession,
    password::verify_password,
    state::AuthState,
    token::{generate_csrf_token, generate_session_id},
    AuthError,
};

const COOKIE_NAME_PROD: &str = "__Host-cd_sid";
const COOKIE_NAME_DEV: &str = "cd_sid";

#[derive(Deserialize)]
pub(crate) struct SignInBody {
    pub username: String,
    pub password: String,
}

#[derive(Serialize)]
pub(crate) struct SignInResp {
    pub csrf_token: String,
}

pub(crate) async fn sign_in(
    State(state): State<AuthState>,
    Json(body): Json<SignInBody>,
) -> Result<Response, AuthError> {
    // Constant-time-ish: do the hash compare regardless of whether the user
    // exists, so timing doesn't disclose existence. We do this by always
    // verifying against a known-bad hash if the user lookup fails.
    let users = UserRepo::new(&state.db);
    let lookup = users.find_by_username(&body.username).await;

    let (user_id_opt, hash_for_verify) = match &lookup {
        Ok(u) => (Some(u.id.clone()), u.password_hash.clone()),
        Err(DbError::NotFound) => (None, ALWAYS_FAIL_HASH.to_string()),
        Err(e) => return Err(AuthError::Internal(e.to_string())),
    };

    let ok = verify_password(&hash_for_verify, &body.password).unwrap_or(false);
    let user_id = match (ok, user_id_opt) {
        (true, Some(id)) => id,
        _ => return Err(AuthError::InvalidCredentials),
    };

    // Mint session
    let sid = generate_session_id();
    let csrf = generate_csrf_token();
    let sessions = SessionRepo::new(&state.db);
    sessions
        .insert(
            &sid,
            &NewSession {
                user_id,
                csrf_token: csrf.clone(),
                ttl: state.session_ttl,
            },
        )
        .await
        .map_err(|e| AuthError::Internal(e.to_string()))?;

    let cookie = build_session_cookie(&sid, state.cookie_secure, state.session_ttl);
    let mut resp = (StatusCode::OK, Json(SignInResp { csrf_token: csrf })).into_response();
    resp.headers_mut()
        .insert(header::SET_COOKIE, HeaderValue::from_str(&cookie).unwrap());
    Ok(resp)
}

pub(crate) async fn sign_out(
    State(state): State<AuthState>,
    session: AuthSession,
    headers: HeaderMap,
) -> Result<Response, AuthError> {
    let _ = &headers; // CSRF check is enforced by the router middleware in drive-http.
    let sessions = SessionRepo::new(&state.db);
    sessions
        .delete(&session.session_id)
        .await
        .map_err(|e| AuthError::Internal(e.to_string()))?;
    let clear = clear_session_cookie(state.cookie_secure);
    let mut resp = StatusCode::NO_CONTENT.into_response();
    resp.headers_mut()
        .insert(header::SET_COOKIE, HeaderValue::from_str(&clear).unwrap());
    Ok(resp)
}

pub(crate) fn cookie_name(secure: bool) -> &'static str {
    // `__Host-` prefix requires Secure + Path=/ + no Domain — only valid over
    // HTTPS. In unencrypted dev we drop the prefix.
    if secure {
        COOKIE_NAME_PROD
    } else {
        COOKIE_NAME_DEV
    }
}

fn build_session_cookie(id: &str, secure: bool, ttl: time::Duration) -> String {
    let name = cookie_name(secure);
    let max_age = ttl.whole_seconds().max(0);
    let secure_part = if secure { "; Secure" } else { "" };
    format!("{name}={id}; Path=/; HttpOnly{secure_part}; SameSite=Lax; Max-Age={max_age}")
}

fn clear_session_cookie(secure: bool) -> String {
    let name = cookie_name(secure);
    let secure_part = if secure { "; Secure" } else { "" };
    format!("{name}=; Path=/; HttpOnly{secure_part}; SameSite=Lax; Max-Age=0")
}

/// A known-bad argon2id hash used to keep timing constant when the username
/// doesn't exist. Generated for password "always-fails" — verify against it
/// will never succeed for real passwords.
const ALWAYS_FAIL_HASH: &str =
    "$argon2id$v=19$m=19456,t=2,p=1$YWx3YXlzZmFpbHM$XKy+nb8s4mFcj2J3vYwS5QqXFL6jvVK0WkpHWfsxqJ8";
