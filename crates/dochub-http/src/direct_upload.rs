//! Pipeline §13.6 — direct-to-storage upload endpoints.
//! Spec: docs/research/10-direct-upload.md.
//!
//! **Direct-to-storage upload is DISABLED** (audit finding, critical). A native
//! presigned PUT lets the client write PLAINTEXT document bytes straight to the
//! storage backend, and because the server holds the encryption keys those
//! bytes can never be sealed at rest — violating the inviolable "no plaintext
//! document bytes ever reach a storage backend" rule. `POST /api/files/upload-url`
//! now always returns 409, which the SPA (`api/client.ts`) already handles by
//! falling back to the proxy multipart path at `POST /api/files` (`files.rs`) —
//! the sole write path for document bytes, which seals them in-memory before
//! they touch storage. Uploads are thus bounded by `DOCHUB_BODY_LIMIT_MB`.
//!
//! `complete` / `abort` remain as inert handlers (nothing creates the
//! `uploading` rows they operate on anymore).

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use bytes::BytesMut;
use dochub_auth::AuthSession;
use dochub_db::{AuditRepo, FileRepo, FileStatus, NewAuditEvent};
use futures::TryStreamExt;
use serde::Serialize;

use crate::{
    files::{storage_key, FileDto},
    HttpState,
};

/// Range fetched for the post-finalize magic-byte sniff (§13.6a). 4 KB
/// is more than enough — `infer`'s longest signature peeks at the
/// first ~262 bytes; the bigger window covers tar/zip headers that
/// trail past the first sector.
const SNIFF_BYTES: u64 = 4 * 1024;

/// 8 MiB — the SPA opts into direct upload at this threshold. We
/// don't enforce it server-side (the proxy path keeps working at any
/// size) but we *do* document it so the SPA's branching stays in sync.
#[allow(dead_code)]
pub(crate) const DIRECT_UPLOAD_THRESHOLD_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Debug)]
pub(crate) enum DirectError {
    Forbidden,
    NotFound,
    AdapterCannotPresign,
    QuotaExceeded {
        used: u64,
        quota: u64,
    },
    NotUploading,
    /// 409 — an active legal hold covers this file; even a not-yet-finalized
    /// row cannot be hard-deleted while held (build spec §3).
    UnderLegalHold,
    /// §13.6a — first-bytes sniff at finalize rejected the upload.
    /// Carries the detected extension/type so the SPA can surface
    /// "we don't accept .exe" inline.
    ForbiddenContent(String),
    Internal(String),
}

#[derive(Serialize)]
struct Err<'a> {
    error: &'a str,
}

impl IntoResponse for DirectError {
    fn into_response(self) -> Response {
        match self {
            Self::Forbidden => {
                (StatusCode::FORBIDDEN, Json(Err { error: "forbidden" })).into_response()
            }
            Self::NotFound => {
                (StatusCode::NOT_FOUND, Json(Err { error: "not found" })).into_response()
            }
            // 409 — SPA branches to proxy upload when it sees this.
            Self::AdapterCannotPresign => (
                StatusCode::CONFLICT,
                Json(Err {
                    error: "this workspace's storage adapter doesn't support direct upload",
                }),
            )
                .into_response(),
            Self::QuotaExceeded { used, quota } => (
                StatusCode::PAYLOAD_TOO_LARGE,
                Json(serde_json::json!({
                    "error": "workspace quota would be exceeded",
                    "used_bytes": used,
                    "quota_bytes": quota,
                })),
            )
                .into_response(),
            Self::NotUploading => (
                StatusCode::CONFLICT,
                Json(Err {
                    error: "file is not in 'uploading' state",
                }),
            )
                .into_response(),
            Self::UnderLegalHold => (
                StatusCode::CONFLICT,
                Json(Err {
                    error: "under legal hold",
                }),
            )
                .into_response(),
            Self::ForbiddenContent(kind) => (
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                Json(serde_json::json!({
                    "error": format!("file rejected by content sniff: {kind}"),
                    "kind": kind,
                })),
            )
                .into_response(),
            Self::Internal(m) => {
                tracing::error!(error = %m, "direct_upload handler error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(Err {
                        error: "internal error",
                    }),
                )
                    .into_response()
            }
        }
    }
}

// ── Handlers ──────────────────────────────────────────────────────────

pub(crate) async fn presign(_session: AuthSession) -> DirectError {
    // Direct-to-storage upload is DISABLED (audit finding: critical).
    //
    // A native presigned PUT hands the client a path to write PLAINTEXT
    // document bytes straight to the storage backend. Because the server holds
    // the encryption keys (the documents-first, not-zero-knowledge model),
    // client-written bytes can never be sealed at rest — even a re-seal on
    // `complete` leaves a plaintext window in the bucket and orphaned plaintext
    // if the client abandons the upload. That violates the inviolable rule that
    // *no plaintext document bytes ever reach a storage backend*.
    //
    // Return the same 409 an adapter-that-can't-presign returns; the SPA already
    // handles it by falling back to the proxy upload path, which is the sole
    // write path for document bytes and seals them in-memory before they touch
    // storage. Trade-off: uploads are bounded by the proxy body limit
    // (DOCHUB_BODY_LIMIT_MB) — acceptable for a documents-only hub.
    DirectError::AdapterCannotPresign
}

pub(crate) async fn complete(
    State(s): State<HttpState>,
    session: AuthSession,
    Path(id): Path<String>,
) -> Result<Json<FileDto>, DirectError> {
    let repo = FileRepo::new(&s.db);
    let row = repo
        .find_by_id(&id)
        .await
        .map_err(|_| DirectError::NotFound)?;

    require_membership(&s, &session, &row).await?;

    if row.status != FileStatus::Uploading {
        return Err(DirectError::NotUploading);
    }

    // Pick the right adapter (this also handles BYO rows whose key
    // version may have been bumped since presign — read fresh).
    let workspace_id = row
        .workspace_id
        .clone()
        .ok_or_else(|| DirectError::Internal("file row has no workspace_id".into()))?;
    let (storage, _) = crate::workspace_storage::resolve_upload_storage(&s, &workspace_id)
        .await
        .map_err(|e| DirectError::Internal(format!("storage: {e:?}")))?;

    let key = storage_key(&row.id);
    let meta = storage.stat(&key).await.map_err(|e| match e {
        dochub_storage::StorageError::NotFound(_) => DirectError::NotFound,
        other => DirectError::Internal(format!("stat: {other}")),
    })?;

    // §13.6a — post-finalize documents-only guard. The bucket received
    // the bytes directly from the client; the server never inspected
    // them until now. Fetch the first 4 KB via the same adapter (one
    // extra range-GET; sub-100 ms on S3 / fs / memory) and run the full
    // allowlist + magic-byte sniff. This closes the presign gap: the
    // extension was checked at presign, but only here can we confirm the
    // bytes actually match a documents-only format.
    let sniff_end = SNIFF_BYTES.min(meta.size.max(1));
    let head_bytes = if meta.size == 0 {
        Vec::new()
    } else {
        let (_, stream) = storage
            .get(&key, Some(0..sniff_end))
            .await
            .map_err(|e| DirectError::Internal(format!("sniff get: {e}")))?;
        let buf: BytesMut = stream
            .try_fold(BytesMut::new(), |mut acc, chunk| async move {
                acc.extend_from_slice(&chunk);
                Ok(acc)
            })
            .await
            .map_err(|e| DirectError::Internal(format!("sniff stream: {e}")))?;
        buf.to_vec()
    };

    let kind = match dochub_core::ingest::guard(&row.name, &head_bytes) {
        Ok(k) => k,
        Err(e) => {
            let reason = ingest_reason(&e);
            // Roll back: object + row both go away so the caller sees
            // a clean failure and the workspace isn't billed for the
            // bytes still in the bucket.
            let s2 = s.clone();
            let key2 = key.clone();
            let row_id = row.id.clone();
            tokio::spawn(async move {
                let _ = storage.delete(&key2).await;
                let _ = FileRepo::new(&s2.db).delete_by_id(&row_id).await;
            });
            AuditRepo::emit(
                &s.db,
                NewAuditEvent {
                    actor_id: Some(session.user_id.clone()),
                    actor_username: Some(session.username.clone()),
                    action: "files.upload_rejected".into(),
                    target_kind: Some("file".into()),
                    target_id: Some(row.id.clone()),
                    target_name: Some(row.name.clone()),
                    ip_address: None,
                    metadata: Some(format!(
                        r#"{{"reason":"forbidden_content","kind":"{reason}","direct":true}}"#
                    )),
                },
            );
            return Err(DirectError::ForbiddenContent(reason));
        }
    };

    // The guard's canonical MIME is authoritative — it wins over both the
    // client's claim AND the storage adapter's echoed Content-Type (S3
    // mirrors back whatever the client sent at PUT; same untrusted source).
    let authoritative_ct = kind.mime_type();

    // Authoritative quota gate. Presign checked the *declared* size against
    // the then-current usage, but that gate leaks two ways: (a) concurrent
    // presigns race — each runs its check before inserting its `uploading`
    // row, so neither counts the other's in-flight bytes — and (b) the client
    // can PUT more bytes to the signed URL than it declared. Re-check here
    // against `meta.size` (the real bytes the bucket holds) before committing;
    // roll back the object + row on breach so the workspace isn't billed for
    // bytes it can't keep. Best-effort like the presign gate — not fully
    // atomic under simultaneous completes — but it closes the declared-size
    // and over-presign holes.
    let me = dochub_db::UserRepo::new(&s.db)
        .find_by_id(&session.user_id)
        .await
        .map_err(|e| DirectError::Internal(e.to_string()))?;
    if let Some(quota) = me.quota_bytes {
        let used_incl = repo
            .workspace_used_bytes(&workspace_id)
            .await
            .map_err(|e| DirectError::Internal(e.to_string()))?;
        // `used_incl` already counts THIS still-`uploading` row via its
        // `expected_size`; subtract it so we compare the projected post-commit
        // total, not double-count.
        let used = used_incl.saturating_sub(row.expected_size.unwrap_or(0));
        if used.saturating_add(meta.size) > quota {
            // Mirror the forbidden-content rollback: object + row both go away.
            let s2 = s.clone();
            let key2 = key.clone();
            let row_id = row.id.clone();
            tokio::spawn(async move {
                let _ = storage.delete(&key2).await;
                let _ = FileRepo::new(&s2.db).delete_by_id(&row_id).await;
            });
            AuditRepo::emit(
                &s.db,
                NewAuditEvent {
                    actor_id: Some(session.user_id.clone()),
                    actor_username: Some(session.username.clone()),
                    action: "files.upload_rejected".into(),
                    target_kind: Some("file".into()),
                    target_id: Some(row.id.clone()),
                    target_name: Some(row.name.clone()),
                    ip_address: None,
                    metadata: Some(format!(
                        r#"{{"reason":"quota","used_bytes":{used},"quota_bytes":{quota},"size":{},"direct":true}}"#,
                        meta.size
                    )),
                },
            );
            return Err(DirectError::QuotaExceeded { used, quota });
        }
    }

    let finalized = repo
        .mark_uploaded(
            &row.id,
            meta.size,
            meta.etag.as_deref(),
            Some(authoritative_ct),
        )
        .await
        .map_err(|e| DirectError::Internal(e.to_string()))?;

    AuditRepo::emit(
        &s.db,
        NewAuditEvent {
            actor_id: Some(session.user_id.clone()),
            actor_username: Some(session.username.clone()),
            action: "files.upload_completed".into(),
            target_kind: Some("file".into()),
            target_id: Some(finalized.id.clone()),
            target_name: Some(finalized.name.clone()),
            ip_address: None,
            metadata: Some(format!(
                r#"{{"size":{},"sniffed_mime":{},"direct":true}}"#,
                finalized.size,
                serde_json::to_string(authoritative_ct).unwrap_or_else(|_| "\"\"".into()),
            )),
        },
    );

    Ok(Json(FileDto::from(finalized)))
}

pub(crate) async fn abort(
    State(s): State<HttpState>,
    session: AuthSession,
    Path(id): Path<String>,
) -> Result<StatusCode, DirectError> {
    let repo = FileRepo::new(&s.db);
    let row = match repo.find_by_id(&id).await {
        Ok(r) => r,
        // Idempotent: already gone is fine.
        Err(_) => return Ok(StatusCode::NO_CONTENT),
    };
    require_membership(&s, &session, &row).await?;

    if row.status != FileStatus::Uploading {
        // Only abort uploading rows — refuse to nuke ready files via
        // this endpoint.
        return Err(DirectError::NotUploading);
    }

    // Compliance guard (build spec §3): a hard-delete is a destructive path, so
    // an active legal hold blocks the abort just like it blocks trash/purge.
    if crate::compliance::is_under_hold(&s.db, &row)
        .await
        .map_err(|e| DirectError::Internal(e.to_string()))?
    {
        return Err(DirectError::UnderLegalHold);
    }

    // Best-effort delete of the object. We swallow errors because the
    // bucket may not have received any bytes (or the PUT may have
    // already failed) — either way, the row going away is what matters.
    if let Some(workspace_id) = row.workspace_id.clone() {
        if let Ok((storage, _)) =
            crate::workspace_storage::resolve_upload_storage(&s, &workspace_id).await
        {
            let _ = storage.delete(&crate::files::storage_key(&row.id)).await;
        }
    }

    repo.delete_by_id(&row.id)
        .await
        .map_err(|e| DirectError::Internal(e.to_string()))?;

    AuditRepo::emit(
        &s.db,
        NewAuditEvent {
            actor_id: Some(session.user_id.clone()),
            actor_username: Some(session.username.clone()),
            action: "files.upload_aborted".into(),
            target_kind: Some("file".into()),
            target_id: Some(row.id),
            target_name: Some(row.name),
            ip_address: None,
            metadata: None,
        },
    );

    Ok(StatusCode::NO_CONTENT)
}

async fn require_membership(
    s: &HttpState,
    session: &AuthSession,
    row: &dochub_db::File,
) -> Result<(), DirectError> {
    let Some(workspace_id) = row.workspace_id.as_deref() else {
        // Legacy row (pre-§8.8). Fall back to owner check.
        if row.owner_id != session.user_id {
            return Err(DirectError::Forbidden);
        }
        return Ok(());
    };
    let role = dochub_db::WorkspaceMemberRepo::new(&s.db)
        .role_of(workspace_id, &session.user_id)
        .await
        .map_err(|e| DirectError::Internal(e.to_string()))?;
    if role.is_none() {
        return Err(DirectError::Forbidden);
    }
    Ok(())
}

/// A short, stable machine token for why the finalize guard rejected an
/// upload — surfaced to the SPA in `ForbiddenContent` and recorded in the
/// `files.upload_rejected` audit metadata. For a disallowed extension it's the
/// extension itself (e.g. `mp4`); otherwise a fixed slug.
fn ingest_reason(e: &dochub_core::ingest::IngestError) -> String {
    use dochub_core::ingest::IngestError as I;
    match e {
        I::EmptyInput => "empty".into(),
        I::MissingExtension => "no_extension".into(),
        I::DisallowedExtension(ext) => ext.clone(),
        I::ContentMismatch => "content_mismatch".into(),
    }
}

pub(crate) fn router(state: HttpState) -> Router {
    Router::new()
        .route("/api/files/upload-url", post(presign))
        .route("/api/files/{id}/complete", post(complete))
        .route("/api/files/{id}/abort", post(abort))
        .with_state(state)
}
