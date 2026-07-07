//! Version-history REST API (build spec §2 — P1.3). Exposes the existing
//! encrypted version engine ([`dochub_db::Registry`]) over HTTP so the SPA's
//! version-history surface can browse, read, restore, and verify a file's
//! immutable, hash-chained history.
//!
//! Endpoints (mounted under `/api`, app origin, owner-gated like the sibling
//! file handlers in [`crate::files`]):
//!
//! - `GET  /api/files/{id}/versions`               — list the chain, head first
//! - `GET  /api/files/{id}/versions/{seq}/content` — decrypted bytes of a version
//! - `POST /api/files/{id}/restore/{seq}`          — restore a version as new head
//! - `GET  /api/files/{id}/verify`                 — verify the hash chain
//!
//! No code path here mutates history: `restore` is additive (a new head), and
//! everything else is a read. Reuses [`crate::files::FilesError`] for status +
//! error-body shape so the version surface and the file surface answer alike.

use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderValue},
    response::Response,
    routing::{get, post},
    Json, Router,
};
use dochub_crypto::ChainStatus;
use dochub_db::{
    action, AuditRepo, FileRepo, FileVersionsRepo, NewAuditEvent, RegistryError, Version,
};
use serde::Serialize;

use crate::files::{version_registry, FilesError};
use crate::HttpState;

/// One row of a file's version history. Mirrors [`dochub_db::Version`] minus the
/// internal `storage_key` (never leaked — it's the content-addressed cipher key)
/// and `file_id` (already in the URL). `created_at` is RFC-3339 UTC.
#[derive(Serialize)]
struct VersionDto {
    seq: i64,
    size: i64,
    content_hash: String,
    prev_hash: Option<String>,
    author_id: String,
    reason: Option<String>,
    created_at: String,
}

impl From<Version> for VersionDto {
    fn from(v: Version) -> Self {
        Self {
            seq: v.seq,
            size: v.size,
            content_hash: v.content_hash,
            prev_hash: v.prev_hash,
            author_id: v.author_id,
            reason: v.reason,
            created_at: v
                .created_at
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default(),
        }
    }
}

/// `GET /api/files/{id}/verify` body. Serializes to `{"status":"intact"}` or
/// `{"status":"broken","at_seq":N}` where `at_seq` is the 1-based `seq` of the
/// first tampered / mislinked version.
#[derive(Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
enum VerifyResp {
    Intact,
    Broken { at_seq: i64 },
}

/// Map a registry failure onto the shared file-API error surface. A missing
/// version (unknown `seq`) is a 404; everything else is an internal error — key
/// material and plaintext never appear in these strings by construction.
fn map_registry_err(e: RegistryError) -> FilesError {
    match e {
        RegistryError::VersionNotFound => FilesError::NotFound,
        other => FilesError::Internal(other.to_string()),
    }
}

/// Look up the file and enforce the owner gate — the same check the sibling
/// `/api/files/{id}/...` handlers apply.
async fn owned_file(
    s: &HttpState,
    id: &str,
    session: &dochub_auth::AuthSession,
) -> Result<dochub_db::File, FilesError> {
    let file = FileRepo::new(&s.db)
        .find_by_id(id)
        .await
        .map_err(|_| FilesError::NotFound)?;
    if file.owner_id != session.user_id {
        return Err(FilesError::Forbidden);
    }
    Ok(file)
}

/// `GET /api/files/{id}/versions` — the full hash chain, head (highest `seq`)
/// first.
async fn list_versions(
    State(s): State<HttpState>,
    session: dochub_auth::AuthSession,
    Path(id): Path<String>,
) -> Result<Json<Vec<VersionDto>>, FilesError> {
    owned_file(&s, &id, &session).await?;
    let chain = FileVersionsRepo::new(&s.db)
        .list_chain(&id)
        .await
        .map_err(|e| FilesError::Internal(e.to_string()))?;
    // `list_chain` is ascending (seq=1 first); the surface wants head first.
    let dtos: Vec<VersionDto> = chain.into_iter().rev().map(VersionDto::from).collect();
    Ok(Json(dtos))
}

/// `GET /api/files/{id}/versions/{seq}/content` — decrypt and stream the bytes
/// committed at `seq`. 404 when the seq has no committed version. Same
/// content-type + no-store streaming shape as `GET /api/files/{id}/content`.
async fn version_content(
    State(s): State<HttpState>,
    session: dochub_auth::AuthSession,
    Path((id, seq)): Path<(String, i64)>,
) -> Result<Response, FilesError> {
    let file = owned_file(&s, &id, &session).await?;
    let bytes = version_registry(&s)
        .read_version(&id, seq)
        .await
        .map_err(map_registry_err)?;
    let size = bytes.len();
    let content_type = file
        .content_type
        .as_deref()
        .unwrap_or("application/octet-stream");

    let mut response = Response::new(Body::from(bytes));
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(content_type)
            .unwrap_or(HeaderValue::from_static("application/octet-stream")),
    );
    headers.insert(
        header::CONTENT_LENGTH,
        HeaderValue::from_str(&size.to_string()).unwrap(),
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store, no-cache, must-revalidate"),
    );
    Ok(response)
}

/// `POST /api/files/{id}/restore/{seq}` — re-commit version `seq`'s plaintext as
/// a new head (additive; the chain is untouched). Returns the new head version
/// and emits a `version.restore` audit event.
async fn restore_version(
    State(s): State<HttpState>,
    session: dochub_auth::AuthSession,
    Path((id, seq)): Path<(String, i64)>,
) -> Result<Json<VersionDto>, FilesError> {
    let file = owned_file(&s, &id, &session).await?;
    let new_head = version_registry(&s)
        .restore_version(&id, seq, &session.user_id)
        .await
        .map_err(map_registry_err)?;

    AuditRepo::emit(
        &s.db,
        NewAuditEvent {
            actor_id: Some(session.user_id.clone()),
            actor_username: Some(session.username.clone()),
            action: action::VERSION_RESTORE.into(),
            target_kind: Some("file".into()),
            target_id: Some(file.id.clone()),
            target_name: Some(file.name.clone()),
            ip_address: None,
            metadata: Some(format!(
                r#"{{"restored_from":{seq},"new_seq":{}}}"#,
                new_head.seq
            )),
        },
    );

    Ok(Json(new_head.into()))
}

/// `GET /api/files/{id}/verify` — recompute the hash chain and report whether it
/// is intact or the 1-based `seq` of the first broken link.
async fn verify(
    State(s): State<HttpState>,
    session: dochub_auth::AuthSession,
    Path(id): Path<String>,
) -> Result<Json<VerifyResp>, FilesError> {
    owned_file(&s, &id, &session).await?;
    let status = version_registry(&s)
        .verify_chain(&id)
        .await
        .map_err(map_registry_err)?;
    let body = match status {
        ChainStatus::Intact => VerifyResp::Intact,
        // `at_index` is zero-based (chain order = seq-1); surface the seq.
        ChainStatus::Broken { at_index, .. } => VerifyResp::Broken {
            at_seq: at_index as i64 + 1,
        },
    };
    Ok(Json(body))
}

pub(crate) fn router(state: HttpState) -> Router {
    Router::new()
        .route("/api/files/{id}/versions", get(list_versions))
        .route(
            "/api/files/{id}/versions/{seq}/content",
            get(version_content),
        )
        .route("/api/files/{id}/restore/{seq}", post(restore_version))
        .route("/api/files/{id}/verify", get(verify))
        .with_state(state)
}
