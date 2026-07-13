//! `POST /api/files/{id}/summary` — summarize a document.
//!
//! Runs the offline [`dochub_ai::summarize`] extractive summarizer over a file's
//! head text and returns a short, read-only suggestion. This is the HTTP surface
//! over the Phase 5 summary primitive; the summary itself is a pure, offline,
//! dependency-free extract (top salient sentences, in document order).
//!
//! Guarantees mirror the PII surface ([`crate::pii_http`]):
//! - **Permission-filtered.** The caller must be able to *view* the file.
//! - **Read-only.** Head bytes are read through the encrypted version engine
//!   ([`Registry::read_version`] — a pure read, no backfill), never written.
//!   The summary is purely extractive: it invents nothing and never mutates the
//!   document or its history.
//! - **Audited.** Every summary appends an `ai.summary` event.

use axum::{
    extract::{Path, Query, State},
    Json,
};
use dochub_auth::AuthSession;
use dochub_core::DocKind;
use dochub_db::{
    action, AuditRepo, FileRepo, FileVersionsRepo, NewAuditEvent, Registry, WorkspaceDeks,
};
use serde::{Deserialize, Serialize};

use crate::content_search::extension_of;
use crate::error::ApiError;
use crate::HttpState;

/// Default and bounds on the requested sentence count.
const DEFAULT_SENTENCES: usize = 3;
const MAX_SENTENCES: usize = 10;

#[derive(Deserialize)]
pub(crate) struct SummaryQuery {
    /// Requested sentence count; clamped to `1..=10`. Defaults to 3.
    pub sentences: Option<usize>,
}

#[derive(Serialize)]
pub(crate) struct SummaryResponse {
    /// False when the file's format has no text extractor yet (xlsm/pdf): a
    /// no-op rather than a failure, so the surface can say so.
    pub supported: bool,
    /// The summary paragraph. Empty when the document has no extractable text.
    pub summary: String,
    /// The chosen sentences, in document order.
    pub sentences: Vec<String>,
}

/// `POST /api/files/{id}/summary` — session-authed, permission-filtered summary
/// of a document's current head. Read-only; audited.
pub(crate) async fn summarize_file(
    State(s): State<HttpState>,
    session: AuthSession,
    Path(file_id): Path<String>,
    Query(q): Query<SummaryQuery>,
) -> Result<Json<SummaryResponse>, ApiError> {
    let max_sentences = q
        .sentences
        .unwrap_or(DEFAULT_SENTENCES)
        .clamp(1, MAX_SENTENCES);

    // Load + permission-check: the caller must be able to view the file.
    let file = FileRepo::new(&s.db)
        .find_by_id(&file_id)
        .await
        .map_err(|_| ApiError::not_found("no such file"))?;
    let scope = dochub_authz::readable_scope(&s.db, &session.user_id)
        .await
        .map_err(|e| {
            tracing::error!(error = ?e, "summary: scope resolution failed");
            ApiError::internal()
        })?;
    if file.trashed_at.is_some() || !scope.can_view_file(&file) {
        return Err(ApiError::forbidden("not permitted to view this file"));
    }

    // Extractable? md/txt/csv/json/yaml + docx/xlsx/pptx have extractors; xlsm
    // (opaque) and pdf don't yet — report unsupported rather than erroring.
    let kind = extension_of(&file.name)
        .as_deref()
        .and_then(DocKind::from_extension);
    let Some(kind) = kind.filter(|k| dochub_core::supports_extraction(*k)) else {
        return Ok(Json(SummaryResponse {
            supported: false,
            summary: String::new(),
            sentences: Vec::new(),
        }));
    };

    // Pure read of the head bytes through the encrypted version engine, then
    // extract text. No committed head yet ⇒ nothing to summarize.
    let deks = WorkspaceDeks::new(s.db.clone(), s.config.master_kek.clone());
    let registry = Registry::new(s.db.clone(), s.storage.clone(), deks);
    let head = FileVersionsRepo::new(&s.db)
        .head(&file_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "summary: head lookup failed");
            ApiError::internal()
        })?;
    let Some(head) = head else {
        return Ok(Json(SummaryResponse {
            supported: true,
            summary: String::new(),
            sentences: Vec::new(),
        }));
    };
    let bytes = registry
        .read_version(&file_id, head.seq)
        .await
        .map_err(|e| {
            tracing::error!(file_id = %file_id, error = %e, "summary: version read failed");
            ApiError::internal()
        })?;
    // A corrupt/opaque container that won't extract is treated as "no text",
    // not an error — mirrors the indexer's tolerance.
    let text = dochub_core::extract_text(kind, &bytes).unwrap_or_default();

    let summary = dochub_ai::summarize_extractive(&text, max_sentences);

    // Read-only, but audited: record that a summary was generated.
    AuditRepo::emit(
        &s.db,
        NewAuditEvent {
            actor_id: Some(session.user_id),
            actor_username: Some(session.username),
            action: action::AI_SUMMARY.into(),
            target_kind: Some("file".into()),
            target_id: Some(file_id),
            target_name: Some(file.name),
            ip_address: None,
            metadata: Some(format!(r#"{{"sentences":{}}}"#, summary.sentences.len())),
        },
    );

    Ok(Json(SummaryResponse {
        supported: true,
        summary: summary.text,
        sentences: summary.sentences,
    }))
}
