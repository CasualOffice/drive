//! `POST /api/files/{id}/pii` — scan a document for personal data.
//!
//! Runs the offline [`dochub_ai::pii`] detector over a file's extracted head
//! text and returns the flagged spans (masked) for a human to act on. This is
//! the HTTP surface over the Phase 5 PII primitive; the detection itself is a
//! pure, offline, dependency-free scan (email / payment card via Luhn / US SSN /
//! IPv4).
//!
//! Guarantees, all inherited from the pieces it composes:
//! - **Permission-filtered.** The caller must be able to *view* the file
//!   (`readable_scope` + workspace + not-trashed), exactly like content/semantic
//!   search — an agent or user can only scan what they can already read.
//! - **Read-only.** Bytes are read through the encrypted version engine
//!   ([`Registry::read_version`] on the head seq — a pure read, no backfill) and
//!   never written back. Detection never mutates the document or its history.
//! - **No raw PII leaves the detector.** Findings carry a masked preview and a
//!   byte span into the extracted text, never the raw value (see
//!   [`dochub_ai::pii`]), so the response — and the audit row — can't leak.
//! - **Audited.** Every scan appends a `pii.scan` event with the finding count.

use std::collections::BTreeMap;

use axum::{
    extract::{Path, State},
    Json,
};
use dochub_ai::PiiFinding;
use dochub_auth::AuthSession;
use dochub_core::DocKind;
use dochub_db::{
    action, AuditRepo, FileRepo, FileVersionsRepo, NewAuditEvent, Registry, WorkspaceDeks,
};
use serde::Serialize;

use crate::content_search::extension_of;
use crate::error::ApiError;
use crate::HttpState;

#[derive(Serialize)]
pub(crate) struct PiiScanResponse {
    /// False when the file's format has no text extractor yet (xlsm/pdf): the
    /// scan is a no-op rather than a failure, so the surface can say so.
    pub supported: bool,
    /// Flagged spans, ordered by offset, each masked (never the raw value).
    /// Offsets are byte positions in the document's *extracted* text.
    pub findings: Vec<PiiFinding>,
    /// Count per PII kind (`{"email": 2, "credit_card": 1}`) — a quick summary
    /// for the surface without walking `findings`.
    pub counts: BTreeMap<String, usize>,
}

/// `POST /api/files/{id}/pii` — session-authed, permission-filtered PII scan of
/// a document's current head. Read-only; audited.
pub(crate) async fn scan_file_pii(
    State(s): State<HttpState>,
    session: AuthSession,
    Path(file_id): Path<String>,
) -> Result<Json<PiiScanResponse>, ApiError> {
    // Load + permission-check: the caller must be able to view the file.
    let file = FileRepo::new(&s.db)
        .find_by_id(&file_id)
        .await
        .map_err(|_| ApiError::not_found("no such file"))?;
    let scope = dochub_authz::readable_scope(&s.db, &session.user_id)
        .await
        .map_err(|e| {
            tracing::error!(error = ?e, "pii: scope resolution failed");
            ApiError::internal()
        })?;
    if file.trashed_at.is_some() || !scope.can_view_file(&file) {
        // Don't distinguish "exists but forbidden" from "gone" for a trashed or
        // unviewable file beyond the standard 403 — the caller can't see it.
        return Err(ApiError::forbidden("not permitted to view this file"));
    }

    // Extractable? md/txt/csv/json/yaml + docx/xlsx/pptx have extractors; xlsm
    // (opaque) and pdf don't yet — report unsupported rather than erroring.
    let kind = extension_of(&file.name)
        .as_deref()
        .and_then(DocKind::from_extension);
    let Some(kind) = kind.filter(|k| dochub_core::supports_extraction(*k)) else {
        return Ok(Json(PiiScanResponse {
            supported: false,
            findings: Vec::new(),
            counts: BTreeMap::new(),
        }));
    };

    // Pure read of the head bytes through the encrypted version engine, then
    // extract text. No committed head yet ⇒ nothing to scan.
    let deks = WorkspaceDeks::new(s.db.clone(), s.config.master_kek.clone())
        .with_next_kek(s.config.master_kek_next.clone());
    let registry = Registry::new(s.db.clone(), s.storage.clone(), deks);
    let head = FileVersionsRepo::new(&s.db)
        .head(&file_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "pii: head lookup failed");
            ApiError::internal()
        })?;
    let Some(head) = head else {
        return Ok(Json(PiiScanResponse {
            supported: true,
            findings: Vec::new(),
            counts: BTreeMap::new(),
        }));
    };
    let bytes = registry
        .read_version(&file_id, head.seq)
        .await
        .map_err(|e| {
            tracing::error!(file_id = %file_id, error = %e, "pii: version read failed");
            ApiError::internal()
        })?;
    // A corrupt/opaque container that won't extract is treated as "no text",
    // not an error — mirrors the indexer's tolerance.
    let text = dochub_core::extract_text(kind, &bytes).unwrap_or_default();

    let findings = dochub_ai::detect_all(&text);
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    for f in &findings {
        *counts.entry(f.kind.as_str().to_string()).or_insert(0) += 1;
    }

    // Read-only, but audited: record that a scan ran + what it flagged (counts
    // only — never the values). Fire-and-forget on the append-only chain.
    AuditRepo::emit(
        &s.db,
        NewAuditEvent {
            actor_id: Some(session.user_id),
            actor_username: Some(session.username),
            action: action::PII_SCAN.into(),
            target_kind: Some("file".into()),
            target_id: Some(file_id),
            target_name: Some(file.name),
            ip_address: None,
            metadata: Some(format!(r#"{{"findings":{}}}"#, findings.len())),
        },
    );

    Ok(Json(PiiScanResponse {
        supported: true,
        findings,
        counts,
    }))
}
