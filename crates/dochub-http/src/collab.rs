//! Real-time co-editing room brokering (build spec §3 — P2.2).
//!
//! Doc-Hub owns the encrypted canonical bytes + the version chain; the sibling
//! `collab` server (Hocuspocus + Yjs) owns the live `Y.Doc` per room and relays
//! opaque CRDT updates. This module is the bridge between the two:
//!
//! - `GET  /api/files/{id}/collab`          — mint a room grant (room id, ws url,
//!   short-TTL editor access token) for a signed-in owner.
//! - `GET  /api/files/{id}/collab/seed`     — the decrypted head bytes, so the
//!   collab server can seed a fresh room (server-trusted model, see below).
//! - `POST /api/files/{id}/collab/snapshot` — accept the merged room bytes and
//!   `commit_version` them as a new hash-chained version.
//!
//! ## Token contract (alignment with `../collab`)
//!
//! The grant mints the **editor access token** seam already used by the WOPI
//! handoff ([`dochub_wopi::mint_token`]): HS256 over the deployment's editor
//! signing key, claims `(user_id, file_id, perms, exp, jti)`. The `collab`
//! server verifies HS256 access tokens the same way (see its `auth/jwt.ts`,
//! keyed by `CASUAL_JWT_SECRET`), so pointing `CASUAL_JWT_SECRET` at the same
//! key lets it validate this token. `collab` carries the token back to us on the
//! seed + snapshot calls; we re-verify it and enforce that its `file_id` matches
//! the path — a token minted for file A can never seed or snapshot file B.
//!
//! ## Server-trusted seeding
//!
//! The `/seed` endpoint returns **plaintext** head bytes and the live room holds
//! plaintext OOXML — acceptable only under the trusted-server model (CLAUDE.md
//! "Out of scope: Zero-knowledge E2E"). Encryption at rest defends stolen
//! storage/DB, not a compromised trusted server; the canonical bytes are never
//! written back to storage except sealed through the version chain on snapshot.

use std::str::FromStr;
use std::sync::Arc;

use axum::{
    body::{Body, Bytes},
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use dochub_auth::AuthSession;
use dochub_authz::{AuthzError, Permission, ResourceRef};
use dochub_db::{action, AuditRepo, FileRepo, NewAuditEvent, RegistryError};
use dochub_wopi::{mint_token, WopiClaims, WopiPerms};
use jsonwebtoken::{decode, DecodingKey, Validation};
use serde::{Deserialize, Serialize};

use crate::files::version_registry;
use crate::HttpState;

/// Per-grant editor-token TTL. Matches the WOPI handoff (`files::HANDOFF_TTL_SECS`)
/// — a room grant is a per-launch capability, short-lived by design.
const COLLAB_TOKEN_TTL_SECS: i64 = 600;

#[derive(Debug, thiserror::Error)]
enum CollabError {
    /// 404 — no `DOCHUB_COLLAB_URL` configured; co-editing is opt-in and falls
    /// back to single-user editing (P2.1).
    #[error("collab disabled")]
    Disabled,
    #[error("not found")]
    NotFound,
    /// 401 — missing / malformed / expired / bad-signature token.
    #[error("unauthorized")]
    Unauthorized,
    /// 403 — a valid token, but for the wrong file (or lacking write perms).
    #[error("forbidden")]
    Forbidden,
    #[error("bad request")]
    BadRequest,
    #[error("internal: {0}")]
    Internal(String),
}

/// A denied `gate` is a 403; a DB error behind it is opaque 500.
impl From<AuthzError> for CollabError {
    fn from(e: AuthzError) -> Self {
        match e {
            AuthzError::Forbidden => Self::Forbidden,
            AuthzError::Db(e) => Self::Internal(e.to_string()),
        }
    }
}

#[derive(Serialize)]
struct ErrBody {
    error: &'static str,
}

impl IntoResponse for CollabError {
    fn into_response(self) -> Response {
        let (status, error) = match self {
            // Disabled + NotFound both surface as 404 so a probe can't
            // distinguish "collab off" from "no such file".
            Self::Disabled => (StatusCode::NOT_FOUND, "collab disabled"),
            Self::NotFound => (StatusCode::NOT_FOUND, "not found"),
            Self::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized"),
            Self::Forbidden => (StatusCode::FORBIDDEN, "forbidden"),
            Self::BadRequest => (StatusCode::BAD_REQUEST, "bad request"),
            Self::Internal(m) => {
                tracing::error!(error = %m, "collab internal error");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal error")
            }
        };
        (status, Json(ErrBody { error })).into_response()
    }
}

/// `GET /api/files/{id}/collab` response — everything the SPA needs to join the
/// room: the per-document room id, the collab websocket url, and the editor
/// access token the collab server validates.
#[derive(Serialize)]
struct CollabGrant {
    /// Per-document room id. The file id is globally unique (ULID), so it is the
    /// room id — one room per document, workspace membership already enforced
    /// via the owner gate on this endpoint.
    room: String,
    /// The collab server's Hocuspocus sync endpoint (`ws(s)://…/yjs`).
    ws_url: String,
    /// Short-TTL editor access token `(user_id, file_id, perms, exp, jti)`.
    token: String,
}

/// `POST /api/files/{id}/collab/snapshot` response — the committed head.
#[derive(Serialize)]
struct SnapshotResp {
    seq: i64,
    content_hash: String,
    size: i64,
}

/// Token carried on the query string by the collab server's server-to-server
/// calls, mirroring the collab `extractToken` order (`?access_token=`, then the
/// short `?token=` form). The `Authorization: Bearer` header takes precedence.
#[derive(Deserialize)]
struct AccessTokenQuery {
    #[serde(default)]
    access_token: Option<String>,
    #[serde(default)]
    token: Option<String>,
}

/// Derive the collab websocket url from the configured origin: swap the scheme
/// to `ws`/`wss` and point at the Hocuspocus `/yjs` sync path. Query + fragment
/// are dropped — the client attaches the room name + token itself.
fn collab_ws_url(base: &url::Url) -> String {
    let mut u = base.clone();
    let target = match u.scheme() {
        "https" | "wss" => "wss",
        _ => "ws",
    };
    // http/https ↔ ws/wss are all "special" schemes, so this never fails; if a
    // future scheme made it fail we simply keep the original.
    let _ = u.set_scheme(target);
    u.set_path("/yjs");
    u.set_query(None);
    u.set_fragment(None);
    u.to_string()
}

/// Pull the editor access token off the request: `Authorization: Bearer <t>`
/// first, then `?access_token=<t>`, then `?token=<t>`.
fn extract_token(headers: &HeaderMap, q: &AccessTokenQuery) -> Option<String> {
    if let Some(v) = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
    {
        if let Some(rest) = v
            .strip_prefix("Bearer ")
            .or_else(|| v.strip_prefix("bearer "))
        {
            let t = rest.trim();
            if !t.is_empty() {
                return Some(t.to_string());
            }
        }
    }
    q.access_token
        .clone()
        .or_else(|| q.token.clone())
        .filter(|t| !t.is_empty())
}

/// Verify a collab/editor token and enforce the path `file_id` match. Splits the
/// two failure modes the WOPI helper conflates: a bad/expired/missing token is a
/// 401 (`Unauthorized`); a valid token for another file is a 403 (`Forbidden`).
fn verify_collab_token(
    secret: &Arc<[u8; 32]>,
    token: &str,
    url_file_id: &str,
) -> Result<WopiClaims, CollabError> {
    let mut v = Validation::new(jsonwebtoken::Algorithm::HS256);
    v.validate_exp = true;
    v.leeway = 0;
    let data = decode::<WopiClaims>(token, &DecodingKey::from_secret(secret.as_ref()), &v)
        .map_err(|_| CollabError::Unauthorized)?;
    if data.claims.file_id.to_string() != url_file_id {
        return Err(CollabError::Forbidden);
    }
    Ok(data.claims)
}

/// `GET /api/files/{id}/collab` — mint a room grant. Session-authenticated and
/// owner-gated (like the sibling version endpoints). 404 when collab is disabled
/// or the file is missing/trashed.
async fn collab_grant(
    State(s): State<HttpState>,
    session: AuthSession,
    Path(id): Path<String>,
) -> Result<Json<CollabGrant>, CollabError> {
    let collab_url = s.config.collab_url.clone().ok_or(CollabError::Disabled)?;

    let file = FileRepo::new(&s.db)
        .find_by_id(&id)
        .await
        .map_err(|_| CollabError::NotFound)?;
    if file.trashed_at.is_some() {
        return Err(CollabError::NotFound);
    }
    // Authorize against the live grant state, not raw ownership: a bare
    // `owner_id` check both under-authorizes (denies ACL-granted co-editors) and
    // over-authorizes (a user removed from the workspace still owns the row and
    // would keep collab access). `gate` enforces workspace membership + ACL
    // grants uniformly, exactly as `download_file`/version endpoints do.
    crate::authz::gate(
        &s,
        &session,
        ResourceRef::File(file.id.clone()),
        Permission::Edit,
    )
    .await?;

    let file_id = dochub_core::FileId::from_str(&file.id)
        .map_err(|e| CollabError::Internal(format!("file id parse: {e}")))?;
    let exp = time::OffsetDateTime::now_utc().unix_timestamp() + COLLAB_TOKEN_TTL_SECS;
    let claims = WopiClaims {
        user_id: session.user_id.clone(),
        file_id,
        // Write perms: co-editors mutate the room. Read-only presence lands with
        // presence (P2.4); the grant here is the editor capability.
        perms: WopiPerms::Write,
        exp,
        jti: ulid::Ulid::new().to_string(),
    };
    let token = mint_token(&s.jwt_secret, &claims);

    AuditRepo::emit(
        &s.db,
        NewAuditEvent {
            actor_id: Some(session.user_id.clone()),
            actor_username: Some(session.username.clone()),
            action: "collab.grant".into(),
            target_kind: Some("file".into()),
            target_id: Some(file.id.clone()),
            target_name: Some(file.name.clone()),
            ip_address: None,
            metadata: None,
        },
    );

    Ok(Json(CollabGrant {
        room: file.id,
        ws_url: collab_ws_url(&collab_url),
        token,
    }))
}

/// `GET /api/files/{id}/collab/seed` — decrypted head bytes for the collab
/// server to seed a fresh room. Token-authenticated (no session): the token is
/// the capability minted by the grant. 404 when collab is disabled or the file
/// is unknown; 401/403 on token failure.
async fn collab_seed(
    State(s): State<HttpState>,
    Path(id): Path<String>,
    Query(q): Query<AccessTokenQuery>,
    headers: HeaderMap,
) -> Result<Response, CollabError> {
    if s.config.collab_url.is_none() {
        return Err(CollabError::Disabled);
    }
    let token = extract_token(&headers, &q).ok_or(CollabError::Unauthorized)?;
    let claims = verify_collab_token(&s.jwt_secret, &token, &id)?;

    let file = FileRepo::new(&s.db)
        .find_by_id(&id)
        .await
        .map_err(|_| CollabError::NotFound)?;

    let bytes = version_registry(&s)
        .read_or_backfill_for_file(&id, &claims.user_id)
        .await
        .map_err(|e| match e {
            RegistryError::VersionNotFound => CollabError::NotFound,
            other => CollabError::Internal(other.to_string()),
        })?;
    let size = bytes.len();
    let content_type = file
        .content_type
        .as_deref()
        .unwrap_or("application/octet-stream");

    let mut response = Response::new(Body::from(bytes));
    let h = response.headers_mut();
    h.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(content_type)
            .unwrap_or(HeaderValue::from_static("application/octet-stream")),
    );
    h.insert(
        header::CONTENT_LENGTH,
        HeaderValue::from_str(&size.to_string()).unwrap(),
    );
    h.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store, no-cache, must-revalidate"),
    );
    Ok(response)
}

/// `POST /api/files/{id}/collab/snapshot` — commit the merged room bytes as a
/// new hash-chained version. Token-authenticated (write perms required). Emits a
/// `version.commit` audit row. This is the debounced-idle / last-peer-leaves
/// snapshot path (build spec §3, D1) the collab integration calls.
async fn collab_snapshot(
    State(s): State<HttpState>,
    Path(id): Path<String>,
    Query(q): Query<AccessTokenQuery>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<SnapshotResp>, CollabError> {
    if s.config.collab_url.is_none() {
        return Err(CollabError::Disabled);
    }
    let token = extract_token(&headers, &q).ok_or(CollabError::Unauthorized)?;
    let claims = verify_collab_token(&s.jwt_secret, &token, &id)?;
    if !claims.perms.can_write() {
        return Err(CollabError::Forbidden);
    }
    if body.is_empty() {
        return Err(CollabError::BadRequest);
    }

    let file = FileRepo::new(&s.db)
        .find_by_id(&id)
        .await
        .map_err(|_| CollabError::NotFound)?;

    let version = version_registry(&s)
        .commit_for_file(&id, &body, &claims.user_id, "collab snapshot")
        .await
        .map_err(|e| match e {
            RegistryError::VersionNotFound => CollabError::NotFound,
            other => CollabError::Internal(other.to_string()),
        })?;

    AuditRepo::emit(
        &s.db,
        NewAuditEvent {
            actor_id: Some(claims.user_id.clone()),
            actor_username: None,
            action: action::VERSION_COMMIT.into(),
            target_kind: Some("file".into()),
            target_id: Some(file.id.clone()),
            target_name: Some(file.name.clone()),
            ip_address: None,
            metadata: Some(r#"{"via":"collab"}"#.into()),
        },
    );

    Ok(Json(SnapshotResp {
        seq: version.seq,
        content_hash: version.content_hash,
        size: version.size,
    }))
}

pub(crate) fn router(state: HttpState, body_limit_bytes: usize) -> Router {
    Router::new()
        .route("/api/files/{id}/collab", get(collab_grant))
        .route("/api/files/{id}/collab/seed", get(collab_seed))
        .route(
            "/api/files/{id}/collab/snapshot",
            post(collab_snapshot).layer(DefaultBodyLimit::max(body_limit_bytes)),
        )
        .with_state(state)
}
