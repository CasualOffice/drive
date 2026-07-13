//! `/api/tokens` — personal access token (PAT) management.
//!
//! PATs are bearer credentials that let a headless agent authenticate to the
//! MCP endpoint (`/api/mcp`) without a browser session — see
//! [`crate::mcp_http`]. Management itself is **session-only**: you mint and
//! revoke tokens from the browser (a PAT can't mint more PATs), so a leaked
//! token can't bootstrap fresh credentials.
//!
//! The plaintext token is returned **once**, at creation. Only its SHA-256 hash
//! is stored; the server can never show it again. Revocation is a tombstone, so
//! the list keeps revoked/expired rows for audit.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::get,
    Json, Router,
};
use dochub_auth::{generate_api_token, AuthSession};
use dochub_db::{action, ApiTokenRepo, AuditRepo, NewApiToken, NewAuditEvent};
use serde::{Deserialize, Serialize};
use time::format_description::well_known::Rfc3339;

use crate::HttpState;

/// Upper bound on a token's requested lifetime (~10 years) and label length.
const MAX_EXPIRES_DAYS: u32 = 3650;
const MAX_NAME_LEN: usize = 100;

pub(crate) fn router(state: HttpState) -> Router {
    Router::new()
        .route("/api/tokens", get(list_tokens).post(create_token))
        .route(
            "/api/tokens/{token_id}",
            axum::routing::delete(revoke_token),
        )
        .with_state(state)
}

#[derive(Deserialize)]
pub(crate) struct CreateTokenBody {
    /// Human label for the token ("laptop CLI").
    pub name: String,
    /// Optional lifetime in days; omitted ⇒ no expiry.
    pub expires_in_days: Option<u32>,
}

/// The one-time creation response — the only time `token` (plaintext) is shown.
#[derive(Serialize)]
pub(crate) struct CreatedToken {
    pub id: String,
    pub name: String,
    /// Plaintext token — shown once, never recoverable.
    pub token: String,
    pub created_at: String,
    pub expires_at: Option<String>,
}

#[derive(Serialize)]
pub(crate) struct TokenInfo {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub expires_at: Option<String>,
    pub last_used_at: Option<String>,
    pub revoked_at: Option<String>,
    /// True when neither revoked nor past expiry.
    pub active: bool,
}

fn iso(t: time::OffsetDateTime) -> String {
    t.format(&Rfc3339).unwrap_or_default()
}

/// `POST /api/tokens` — mint a token. Session-authed; returns the plaintext once.
pub(crate) async fn create_token(
    State(s): State<HttpState>,
    session: AuthSession,
    Json(body): Json<CreateTokenBody>,
) -> Result<(StatusCode, Json<CreatedToken>), StatusCode> {
    let name = body.name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME_LEN {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }
    let expires_at = match body.expires_in_days {
        Some(0) => return Err(StatusCode::UNPROCESSABLE_ENTITY),
        Some(days) => {
            let days = days.min(MAX_EXPIRES_DAYS);
            Some(time::OffsetDateTime::now_utc() + time::Duration::days(i64::from(days)))
        }
        None => None,
    };

    let (plaintext, token_hash) = generate_api_token();
    let created = ApiTokenRepo::new(&s.db)
        .insert(&NewApiToken {
            user_id: session.user_id.clone(),
            name: name.to_string(),
            token_hash,
            expires_at,
        })
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "create token failed");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // Credential issued — record it on the append-only audit chain.
    AuditRepo::emit(
        &s.db,
        NewAuditEvent {
            actor_id: Some(session.user_id),
            actor_username: Some(session.username),
            action: action::TOKEN_CREATED.into(),
            target_kind: Some("api_token".into()),
            target_id: Some(created.id.clone()),
            target_name: Some(created.name.clone()),
            ip_address: None,
            metadata: Some(format!(r#"{{"expires":{}}}"#, created.expires_at.is_some())),
        },
    );

    Ok((
        StatusCode::CREATED,
        Json(CreatedToken {
            id: created.id,
            name: created.name,
            token: plaintext,
            created_at: iso(created.created_at),
            expires_at: created.expires_at.map(iso),
        }),
    ))
}

/// `GET /api/tokens` — list the caller's tokens (metadata only, no secrets).
pub(crate) async fn list_tokens(
    State(s): State<HttpState>,
    session: AuthSession,
) -> Result<Json<Vec<TokenInfo>>, StatusCode> {
    let now = time::OffsetDateTime::now_utc();
    let tokens = ApiTokenRepo::new(&s.db)
        .list_for_user(&session.user_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "list tokens failed");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    Ok(Json(
        tokens
            .into_iter()
            .map(|t| TokenInfo {
                active: t.is_active(now),
                id: t.id,
                name: t.name,
                created_at: iso(t.created_at),
                expires_at: t.expires_at.map(iso),
                last_used_at: t.last_used_at.map(iso),
                revoked_at: t.revoked_at.map(iso),
            })
            .collect(),
    ))
}

/// `DELETE /api/tokens/{id}` — revoke a token (tombstone). 404 when it isn't the
/// caller's or is already revoked.
pub(crate) async fn revoke_token(
    State(s): State<HttpState>,
    session: AuthSession,
    Path(token_id): Path<String>,
) -> Result<StatusCode, StatusCode> {
    let revoked = ApiTokenRepo::new(&s.db)
        .revoke(&token_id, &session.user_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "revoke token failed");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    if revoked {
        // Credential revoked — record it on the append-only audit chain.
        AuditRepo::emit(
            &s.db,
            NewAuditEvent {
                actor_id: Some(session.user_id),
                actor_username: Some(session.username),
                action: action::TOKEN_REVOKED.into(),
                target_kind: Some("api_token".into()),
                target_id: Some(token_id),
                target_name: None,
                ip_address: None,
                metadata: None,
            },
        );
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}
