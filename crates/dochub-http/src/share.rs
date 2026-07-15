//! Share-link API + recipient resolution.
//!
//! Owner endpoints (authed, owner-only):
//!   - POST   /api/files/{id}/share        — mint a share link
//!   - GET    /api/files/{id}/shares       — list shares for one file
//!   - DELETE /api/shares/{id}             — revoke
//!
//! Public endpoints (no auth — protected by token + optional password):
//!   - POST   /api/share/{token}           — resolve metadata; password
//!     check happens here
//!   - GET    /api/share/{token}/download  — 302 to a signed download URL
//!
//! Spec: docs/ux/05-sharing-surface.md.

use std::time::Duration;

use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use base64::Engine as _;
use hmac::{Hmac, Mac};
use sha2::Sha256;

use dochub_auth::{hash_password, verify_password, AuthSession};
use dochub_authz::{Permission, ResourceRef};
use dochub_db::{
    AuditRepo, FileRepo, FolderRepo, NewAuditEvent, NewShareLink, ShareLink, ShareLinkRepo,
};
use dochub_storage::SignedUrl;
use serde::{Deserialize, Serialize};

use crate::authz::gate;
use crate::{files::storage_key, HttpState};

// ── Public DTOs ─────────────────────────────────────────────────────────

#[derive(Serialize)]
pub(crate) struct ShareDto {
    pub id: String,
    pub token: String,
    pub url: String,
    pub permissions: String,
    pub has_password: bool,
    pub expires_at: Option<String>,
    pub created_at: String,
    pub last_accessed_at: Option<String>,
    pub access_count: i64,
}

impl ShareDto {
    fn from_link(link: &ShareLink, app_origin: &url::Url) -> Self {
        let mut url = app_origin.clone();
        url.set_path(&format!("/s/{}", link.token));
        Self {
            id: link.id.clone(),
            token: link.token.clone(),
            url: url.to_string(),
            permissions: link.permissions.clone(),
            has_password: link.password_hash.is_some(),
            expires_at: link.expires_at.map(rfc3339),
            created_at: rfc3339(link.created_at),
            last_accessed_at: link.last_accessed_at.map(rfc3339),
            access_count: link.access_count,
        }
    }
}

// ── Owner-side handlers ────────────────────────────────────────────────

#[derive(Deserialize)]
pub(crate) struct CreateShareBody {
    pub permissions: Option<String>,
    pub password: Option<String>,
    pub expires_in_seconds: Option<i64>,
}

async fn create_share(
    State(s): State<HttpState>,
    session: AuthSession,
    Path(file_id): Path<String>,
    Json(body): Json<CreateShareBody>,
) -> Result<(StatusCode, Json<ShareDto>), ShareError> {
    let perms = body.permissions.as_deref().unwrap_or("view");
    if perms != "view" {
        // Edit permission is reserved for v0.2 — when the WOPI handoff for
        // recipients lands. Reject loudly so the SPA can't silently regress.
        return Err(ShareError::Validation(
            "only 'view' permissions ship in v0".into(),
        ));
    }

    let files = FileRepo::new(&s.db);
    let file = files
        .find_by_id(&file_id)
        .await
        .map_err(|_| ShareError::NotFound)?;
    gate(
        &s,
        &session,
        ResourceRef::File(file.id.clone()),
        Permission::Share,
    )
    .await?;

    let password_hash = match body
        .password
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
    {
        Some(p) if p.chars().count() < 4 => {
            return Err(ShareError::Validation(
                "share password must be at least 4 characters".into(),
            ));
        }
        Some(p) => Some(hash_password(p).map_err(|e| ShareError::Internal(e.to_string()))?),
        None => None,
    };

    let expires_at = body
        .expires_in_seconds
        .filter(|&secs| secs > 0)
        .map(|secs| time::OffsetDateTime::now_utc() + time::Duration::seconds(secs));

    let token = mint_token();
    let file_name = file.name.clone();
    let link = ShareLinkRepo::new(&s.db)
        .insert(&NewShareLink {
            token,
            file_id: Some(file.id.clone()),
            folder_id: None,
            password_hash,
            permissions: perms.to_string(),
            expires_at,
            created_by: session.user_id.clone(),
        })
        .await
        .map_err(|e| ShareError::Internal(e.to_string()))?;

    AuditRepo::emit(
        &s.db,
        NewAuditEvent {
            actor_id: Some(session.user_id.clone()),
            actor_username: Some(session.username.clone()),
            action: "share.create".into(),
            target_kind: Some("share_link".into()),
            target_id: Some(link.id.clone()),
            target_name: Some(file_name),
            ip_address: None,
            metadata: Some(format!(
                r#"{{"file_id":"{}","has_password":{}}}"#,
                file.id,
                link.password_hash.is_some()
            )),
        },
    );

    Ok((
        StatusCode::CREATED,
        Json(ShareDto::from_link(&link, &s.config.app_origin)),
    ))
}

#[derive(Serialize)]
struct ListShares {
    shares: Vec<ShareDto>,
}

async fn list_shares(
    State(s): State<HttpState>,
    session: AuthSession,
    Path(file_id): Path<String>,
) -> Result<Json<ListShares>, ShareError> {
    let files = FileRepo::new(&s.db);
    let file = files
        .find_by_id(&file_id)
        .await
        .map_err(|_| ShareError::NotFound)?;
    gate(
        &s,
        &session,
        ResourceRef::File(file.id.clone()),
        Permission::Share,
    )
    .await?;

    let links = ShareLinkRepo::new(&s.db)
        .list_for_file(&file.id)
        .await
        .map_err(|e| ShareError::Internal(e.to_string()))?;
    let shares = links
        .iter()
        .map(|l| ShareDto::from_link(l, &s.config.app_origin))
        .collect();
    Ok(Json(ListShares { shares }))
}

async fn revoke_share(
    State(s): State<HttpState>,
    session: AuthSession,
    Path(share_id): Path<String>,
) -> Result<StatusCode, ShareError> {
    let repo = ShareLinkRepo::new(&s.db);
    let link = repo
        .find_by_id(&share_id)
        .await
        .map_err(|_| ShareError::NotFound)?;
    if link.created_by != session.user_id {
        // Anti-enumeration: present non-owners with the same 404 as
        // missing links rather than 403 so they can't probe existence.
        return Err(ShareError::NotFound);
    }
    // Look up the target name (denormalised so the audit row survives
    // file/folder deletion). Best-effort — missing target just yields None.
    let target_name = if let Some(fid) = link.file_id.as_deref() {
        FileRepo::new(&s.db)
            .find_by_id(fid)
            .await
            .ok()
            .map(|f| f.name)
    } else if let Some(fid) = link.folder_id.as_deref() {
        FolderRepo::new(&s.db)
            .find_by_id(fid)
            .await
            .ok()
            .map(|f| f.name)
    } else {
        None
    };

    repo.delete(&share_id)
        .await
        .map_err(|e| ShareError::Internal(e.to_string()))?;

    AuditRepo::emit(
        &s.db,
        NewAuditEvent {
            actor_id: Some(session.user_id.clone()),
            actor_username: Some(session.username.clone()),
            action: "share.revoke".into(),
            target_kind: Some("share_link".into()),
            target_id: Some(link.id),
            target_name,
            ip_address: None,
            metadata: None,
        },
    );
    Ok(StatusCode::NO_CONTENT)
}

// ── Owner-side handlers (folder shares) ────────────────────────────────

async fn create_folder_share(
    State(s): State<HttpState>,
    session: AuthSession,
    Path(folder_id): Path<String>,
    Json(body): Json<CreateShareBody>,
) -> Result<(StatusCode, Json<ShareDto>), ShareError> {
    let perms = body.permissions.as_deref().unwrap_or("view");
    if perms != "view" {
        return Err(ShareError::Validation(
            "only 'view' permissions ship in v0".into(),
        ));
    }

    let folders = FolderRepo::new(&s.db);
    let folder = folders
        .find_by_id(&folder_id)
        .await
        .map_err(|_| ShareError::NotFound)?;
    gate(
        &s,
        &session,
        ResourceRef::Folder(folder.id.clone()),
        Permission::Share,
    )
    .await?;
    if folder.trashed_at.is_some() {
        return Err(ShareError::NotFound);
    }

    let password_hash = match body
        .password
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
    {
        Some(p) if p.chars().count() < 4 => {
            return Err(ShareError::Validation(
                "share password must be at least 4 characters".into(),
            ));
        }
        Some(p) => Some(hash_password(p).map_err(|e| ShareError::Internal(e.to_string()))?),
        None => None,
    };

    let expires_at = body
        .expires_in_seconds
        .filter(|&secs| secs > 0)
        .map(|secs| time::OffsetDateTime::now_utc() + time::Duration::seconds(secs));

    let token = mint_token();
    let folder_name = folder.name.clone();
    let link = ShareLinkRepo::new(&s.db)
        .insert(&NewShareLink {
            token,
            file_id: None,
            folder_id: Some(folder.id.clone()),
            password_hash,
            permissions: perms.to_string(),
            expires_at,
            created_by: session.user_id.clone(),
        })
        .await
        .map_err(|e| ShareError::Internal(e.to_string()))?;

    AuditRepo::emit(
        &s.db,
        NewAuditEvent {
            actor_id: Some(session.user_id.clone()),
            actor_username: Some(session.username.clone()),
            action: "share.create".into(),
            target_kind: Some("share_link".into()),
            target_id: Some(link.id.clone()),
            target_name: Some(folder_name),
            ip_address: None,
            metadata: Some(format!(
                r#"{{"folder_id":"{}","has_password":{}}}"#,
                folder.id,
                link.password_hash.is_some()
            )),
        },
    );

    Ok((
        StatusCode::CREATED,
        Json(ShareDto::from_link(&link, &s.config.app_origin)),
    ))
}

async fn list_folder_shares(
    State(s): State<HttpState>,
    session: AuthSession,
    Path(folder_id): Path<String>,
) -> Result<Json<ListShares>, ShareError> {
    let folders = FolderRepo::new(&s.db);
    let folder = folders
        .find_by_id(&folder_id)
        .await
        .map_err(|_| ShareError::NotFound)?;
    gate(
        &s,
        &session,
        ResourceRef::Folder(folder.id.clone()),
        Permission::Share,
    )
    .await?;

    let links = ShareLinkRepo::new(&s.db)
        .list_for_folder(&folder.id)
        .await
        .map_err(|e| ShareError::Internal(e.to_string()))?;
    let shares = links
        .iter()
        .map(|l| ShareDto::from_link(l, &s.config.app_origin))
        .collect();
    Ok(Json(ListShares { shares }))
}

// ── Recipient-side handlers ────────────────────────────────────────────

#[derive(Deserialize, Default)]
pub(crate) struct ResolveBody {
    pub password: Option<String>,
}

#[derive(Serialize)]
struct RecipientFile {
    /// `id` is needed by the recipient page to call the per-file
    /// download endpoint (`/api/share/{token}/download?file_id=…`).
    /// Safe to expose because the share token already gates access.
    id: String,
    name: String,
    size: u64,
    content_type: Option<String>,
    modified_at: String,
}

#[derive(Serialize)]
struct RecipientFolder {
    id: String,
    name: String,
    modified_at: String,
}

/// `kind: "file"` carries the legacy single-file payload; `kind: "folder"`
/// adds a `files` + `folders` listing for the depth-1 children of the
/// shared folder. The SPA branches on `kind` to render the right view.
/// Serialised flat (no nested `data:` wrapper) so the SPA TS type can
/// be a discriminated union without restructuring existing call sites.
#[derive(Serialize)]
#[serde(rename_all = "lowercase", tag = "kind")]
enum Resolved {
    File {
        file: RecipientFile,
        download_url: String,
        permissions: String,
        /// Short-lived proof the password was satisfied; the SPA replays it to
        /// the download endpoint. `None` for links without a password.
        #[serde(skip_serializing_if = "Option::is_none")]
        unlock: Option<String>,
    },
    Folder {
        folder: RecipientFolder,
        files: Vec<RecipientFile>,
        folders: Vec<RecipientFolder>,
        permissions: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        unlock: Option<String>,
    },
}

async fn resolve_share(
    State(s): State<HttpState>,
    Path(token): Path<String>,
    Json(body): Json<ResolveBody>,
) -> Result<Json<Resolved>, ShareError> {
    let repo = ShareLinkRepo::new(&s.db);
    let link = repo
        .find_by_token(&token)
        .await
        .map_err(|_| ShareError::NotFound)?;

    if link.is_expired() {
        return Err(ShareError::Expired);
    }

    if let Some(hash) = link.password_hash.as_deref() {
        let candidate = body.password.as_deref().unwrap_or("");
        if candidate.is_empty() || !verify_password(hash, candidate).unwrap_or(false) {
            return Err(ShareError::PasswordRequired);
        }
    }

    // Password satisfied (or none required) — mint the download unlock so the
    // byte-fetch endpoint can require the same proof. Only password-gated
    // links need it; unprotected links download on the token alone as before.
    let unlock = link.password_hash.as_ref().map(|_| {
        let exp = time::OffsetDateTime::now_utc().unix_timestamp() + UNLOCK_TTL_SECS;
        mint_unlock(&s.config.signed_url_hmac_secret, &link.id, exp)
    });

    if let Some(folder_id) = link.folder_id.as_deref() {
        let folders = FolderRepo::new(&s.db);
        let folder = folders
            .find_by_id(folder_id)
            .await
            .map_err(|_| ShareError::NotFound)?;
        if folder.trashed_at.is_some() {
            return Err(ShareError::NotFound);
        }
        // Depth-1 listing — recursive descent is a Phase-2 polish.
        // Scope by the folder's owner so the recipient sees what the
        // sharer would see, regardless of who's anonymously visiting.
        let child_files = FileRepo::new(&s.db)
            .list_children(Some(&folder.id), &folder.owner_id)
            .await
            .unwrap_or_default();
        let child_folders = folders
            .list_children(Some(&folder.id), &folder.owner_id)
            .await
            .unwrap_or_default();

        let _ = repo.touch(&link.id).await;

        AuditRepo::emit(
            &s.db,
            NewAuditEvent {
                actor_id: None,
                actor_username: None,
                action: "share.access".into(),
                target_kind: Some("share_link".into()),
                target_id: Some(link.id.clone()),
                target_name: Some(folder.name.clone()),
                ip_address: None,
                metadata: Some(format!(
                    r#"{{"token":"{}","folder_id":"{}"}}"#,
                    link.token, folder.id
                )),
            },
        );

        return Ok(Json(Resolved::Folder {
            folder: RecipientFolder {
                id: folder.id.clone(),
                name: folder.name,
                modified_at: rfc3339(folder.modified_at),
            },
            files: child_files
                .into_iter()
                .map(|f| RecipientFile {
                    id: f.id,
                    name: f.name,
                    size: f.size,
                    content_type: f.content_type,
                    modified_at: rfc3339(f.modified_at),
                })
                .collect(),
            folders: child_folders
                .into_iter()
                .map(|f| RecipientFolder {
                    id: f.id,
                    name: f.name,
                    modified_at: rfc3339(f.modified_at),
                })
                .collect(),
            permissions: link.permissions,
            unlock,
        }));
    }

    let file_id = link.file_id.as_deref().ok_or(ShareError::NotFound)?;
    let files = FileRepo::new(&s.db);
    let file = files
        .find_by_id(file_id)
        .await
        .map_err(|_| ShareError::NotFound)?;
    if file.trashed_at.is_some() {
        return Err(ShareError::NotFound);
    }

    // Best-effort touch — failure is non-fatal.
    let _ = repo.touch(&link.id).await;

    AuditRepo::emit(
        &s.db,
        NewAuditEvent {
            actor_id: None, // recipient is anonymous
            actor_username: None,
            action: "share.access".into(),
            target_kind: Some("share_link".into()),
            target_id: Some(link.id.clone()),
            target_name: Some(file.name.clone()),
            ip_address: None,
            metadata: Some(format!(r#"{{"token":"{}"}}"#, link.token)),
        },
    );

    Ok(Json(Resolved::File {
        file: RecipientFile {
            id: file.id,
            name: file.name,
            size: file.size,
            content_type: file.content_type,
            modified_at: rfc3339(file.modified_at),
        },
        download_url: format!("/api/share/{}/download", link.token),
        permissions: link.permissions,
        unlock,
    }))
}

#[derive(Deserialize, Default)]
pub(crate) struct DownloadQuery {
    /// Folder-share recipients pass `?file_id=…` to download a single
    /// child of the shared folder; the server validates the child
    /// actually belongs to that folder before signing the URL. File
    /// shares ignore this — they always serve the link's `file_id`.
    pub file_id: Option<String>,
    /// Unlock proof (`?u=…`) minted by `resolve_share` after a successful
    /// password check. Required for password-gated links; ignored otherwise.
    pub u: Option<String>,
}

async fn download_share(
    State(s): State<HttpState>,
    Path(token): Path<String>,
    Query(query): Query<DownloadQuery>,
) -> Result<Response, ShareError> {
    let repo = ShareLinkRepo::new(&s.db);
    let link = repo
        .find_by_token(&token)
        .await
        .map_err(|_| ShareError::NotFound)?;
    if link.is_expired() {
        return Err(ShareError::Expired);
    }

    // Password-gated links must prove the password was satisfied here too —
    // otherwise the token alone would fetch the bytes and the password would
    // protect only the preview metadata, not the file. `resolve_share` issues
    // a short-lived `unlock` proof after a correct password; the SPA replays
    // it as `?u=…`. No re-prompt: the proof rides along transparently. Links
    // without a password download on the token alone, as before.
    if link.password_hash.is_some() {
        let now = time::OffsetDateTime::now_utc().unix_timestamp();
        let ok = query
            .u
            .as_deref()
            .is_some_and(|u| verify_unlock(&s.config.signed_url_hmac_secret, &link.id, u, now));
        if !ok {
            return Err(ShareError::PasswordRequired);
        }
    }

    let files = FileRepo::new(&s.db);
    let file_id = if let Some(fid) = link.file_id.as_deref() {
        // Single-file share: the link's file is the only valid target.
        // A stray ?file_id=… query is ignored.
        fid.to_string()
    } else if let Some(folder_id) = link.folder_id.as_deref() {
        // Folder share: ?file_id=… must reference a direct child of
        // the shared folder, owned by the folder's owner. Anything
        // else is a 404 — anti-enumeration is the same posture as
        // revoke_share.
        let requested = query.file_id.as_deref().ok_or(ShareError::NotFound)?;
        let folder = FolderRepo::new(&s.db)
            .find_by_id(folder_id)
            .await
            .map_err(|_| ShareError::NotFound)?;
        let file = files
            .find_by_id(requested)
            .await
            .map_err(|_| ShareError::NotFound)?;
        if file.parent_id.as_deref() != Some(&folder.id) || file.owner_id != folder.owner_id {
            return Err(ShareError::NotFound);
        }
        file.id
    } else {
        return Err(ShareError::NotFound);
    };

    let file = files
        .find_by_id(&file_id)
        .await
        .map_err(|_| ShareError::NotFound)?;
    if file.trashed_at.is_some() {
        return Err(ShareError::NotFound);
    }

    let signed = s
        .storage
        .signed_get(&storage_key(&file_id), Duration::from_secs(120))
        .await
        .map_err(|e| ShareError::Internal(e.to_string()))?;

    let target = match signed {
        SignedUrl::Native { url, .. } => url.to_string(),
        SignedUrl::Token { token, .. } => {
            let mut base = s.config.usercontent_origin.clone();
            base.set_path(&format!("/raw/{token}"));
            base.to_string()
        }
    };

    let _ = repo.touch(&link.id).await;

    // `target` is always a serialized `Url` (native signed URL) or the
    // usercontent origin + a URL-safe base64 token, so it's header-safe by
    // construction — but route a theoretical malformation to the existing 500
    // path rather than panicking the handler.
    let location = HeaderValue::from_str(&target)
        .map_err(|_| ShareError::Internal("redirect target is not a valid header value".into()))?;
    let mut r = (StatusCode::FOUND, ()).into_response();
    r.headers_mut().insert(header::LOCATION, location);
    Ok(r)
}

// ── Helpers ─────────────────────────────────────────────────────────────

fn mint_token() -> String {
    // 128 bits of entropy from OsRng → URL-safe base64. 22 chars without
    // padding. Same OsRng channel as dochub-auth's session/CSRF tokens.
    use argon2::password_hash::rand_core::{OsRng, RngCore};
    let mut bytes = [0u8; 16];
    OsRng.fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

type HmacSha256 = Hmac<Sha256>;

/// Unlock proof TTL — long enough to click "download" after entering the
/// password, short enough that a leaked proof ages out quickly.
const UNLOCK_TTL_SECS: i64 = 900; // 15 min

/// Mint a share-unlock proof — `base64url(payload ‖ HMAC(payload))` where
/// payload is `{share_id}\n{exp_unix}`. Issued only after a password-gated
/// `resolve` succeeds so the byte-download endpoint can require proof the
/// password was actually satisfied (otherwise the token alone would fetch the
/// bytes, defeating the password — see `download_share`).
fn mint_unlock(secret: &[u8; 32], share_id: &str, exp_unix: i64) -> String {
    let payload = format!("{share_id}\n{exp_unix}");
    let mut mac = HmacSha256::new_from_slice(secret).expect("hmac key length");
    mac.update(payload.as_bytes());
    let tag = mac.finalize().into_bytes();
    let mut combined = Vec::with_capacity(payload.len() + 32);
    combined.extend_from_slice(payload.as_bytes());
    combined.extend_from_slice(&tag);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(combined)
}

/// Verify a share-unlock proof for `share_id`: constant-time HMAC check (via
/// `verify_slice`), bound to this share, and not expired.
fn verify_unlock(secret: &[u8; 32], share_id: &str, token: &str, now_unix: i64) -> bool {
    let Ok(raw) = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(token) else {
        return false;
    };
    if raw.len() <= 32 {
        return false;
    }
    let (payload, tag) = raw.split_at(raw.len() - 32);
    let mut mac = HmacSha256::new_from_slice(secret).expect("hmac key length");
    mac.update(payload);
    if mac.verify_slice(tag).is_err() {
        return false;
    }
    let Ok(text) = std::str::from_utf8(payload) else {
        return false;
    };
    let Some((sid, exp_str)) = text.split_once('\n') else {
        return false;
    };
    sid == share_id && exp_str.parse::<i64>().is_ok_and(|exp| exp >= now_unix)
}

fn rfc3339(t: time::OffsetDateTime) -> String {
    t.format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

// ── Errors ──────────────────────────────────────────────────────────────

#[derive(Debug, thiserror::Error)]
pub(crate) enum ShareError {
    #[error("not found")]
    NotFound,
    #[error("forbidden")]
    Forbidden,
    #[error("validation: {0}")]
    Validation(String),
    #[error("password required")]
    PasswordRequired,
    #[error("expired")]
    Expired,
    #[error("internal: {0}")]
    Internal(String),
}

#[derive(Serialize)]
struct ErrBody<'a> {
    error: &'a str,
}

impl From<dochub_authz::AuthzError> for ShareError {
    fn from(e: dochub_authz::AuthzError) -> Self {
        match e {
            dochub_authz::AuthzError::Forbidden => Self::Forbidden,
            dochub_authz::AuthzError::Db(err) => Self::Internal(err.to_string()),
        }
    }
}

impl IntoResponse for ShareError {
    fn into_response(self) -> Response {
        match self {
            Self::NotFound => {
                (StatusCode::NOT_FOUND, Json(ErrBody { error: "not found" })).into_response()
            }
            Self::Forbidden => {
                (StatusCode::FORBIDDEN, Json(ErrBody { error: "forbidden" })).into_response()
            }
            Self::Validation(m) => {
                (StatusCode::BAD_REQUEST, Json(ErrBody { error: &m })).into_response()
            }
            Self::PasswordRequired => {
                // 401 + WWW-Authenticate signals to the SPA that a password
                // is needed without having to disambiguate inside the body.
                let mut r = (
                    StatusCode::UNAUTHORIZED,
                    Json(ErrBody {
                        error: "password required",
                    }),
                )
                    .into_response();
                r.headers_mut().insert(
                    header::WWW_AUTHENTICATE,
                    HeaderValue::from_static("x-share-password"),
                );
                r
            }
            Self::Expired => (StatusCode::GONE, Json(ErrBody { error: "expired" })).into_response(),
            Self::Internal(m) => {
                tracing::error!(error = %m, "share internal error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrBody {
                        error: "internal error",
                    }),
                )
                    .into_response()
            }
        }
    }
}

// ── Router ──────────────────────────────────────────────────────────────

pub(crate) fn router(state: HttpState) -> Router {
    Router::new()
        .route("/api/files/{id}/share", post(create_share))
        .route("/api/files/{id}/shares", get(list_shares))
        .route("/api/folders/{id}/share", post(create_folder_share))
        .route("/api/folders/{id}/shares", get(list_folder_shares))
        .route("/api/shares/{id}", delete(revoke_share))
        .route("/api/share/{token}", post(resolve_share))
        .route("/api/share/{token}/download", get(download_share))
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use super::{mint_unlock, verify_unlock, UNLOCK_TTL_SECS};

    const SECRET: [u8; 32] = [7u8; 32];
    const SHARE: &str = "share_01HXY";
    const NOW: i64 = 1_800_000_000;

    #[test]
    fn valid_unlock_verifies() {
        let tok = mint_unlock(&SECRET, SHARE, NOW + UNLOCK_TTL_SECS);
        assert!(verify_unlock(&SECRET, SHARE, &tok, NOW));
    }

    #[test]
    fn expired_unlock_is_rejected() {
        let tok = mint_unlock(&SECRET, SHARE, NOW - 1);
        assert!(!verify_unlock(&SECRET, SHARE, &tok, NOW));
    }

    #[test]
    fn unlock_is_bound_to_its_share() {
        let tok = mint_unlock(&SECRET, SHARE, NOW + UNLOCK_TTL_SECS);
        assert!(!verify_unlock(&SECRET, "share_OTHER", &tok, NOW));
    }

    #[test]
    fn wrong_secret_is_rejected() {
        let tok = mint_unlock(&SECRET, SHARE, NOW + UNLOCK_TTL_SECS);
        assert!(!verify_unlock(&[9u8; 32], SHARE, &tok, NOW));
    }

    #[test]
    fn tampered_and_garbage_tokens_are_rejected() {
        let tok = mint_unlock(&SECRET, SHARE, NOW + UNLOCK_TTL_SECS);
        // Flip the last char of the (base64) proof.
        let mut bad = tok.clone();
        let last = bad.pop().unwrap();
        bad.push(if last == 'A' { 'B' } else { 'A' });
        assert!(!verify_unlock(&SECRET, SHARE, &bad, NOW));
        assert!(!verify_unlock(&SECRET, SHARE, "", NOW));
        assert!(!verify_unlock(&SECRET, SHARE, "!!!not-base64!!!", NOW));
    }
}
