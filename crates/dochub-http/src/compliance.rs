//! Retention + legal-hold compliance layer (build spec §3 — P1.2).
//!
//! Two responsibilities:
//!
//! 1. **Guards** ([`hold_guard`], [`retention_blocks_purge`]) consulted by every
//!    destructive path in `dochub-http` (the trash handler in [`crate::files`],
//!    the hard-delete abort in [`crate::direct_upload`], and the purge handler
//!    below). A file under an active legal hold — directly, via its project
//!    (parent folder), or via its workspace — can be neither tombstoned nor
//!    purged; the guard rejects with `409 UnderLegalHold`. Retention blocks a
//!    *permanent purge* of versions still inside `min_age_days` / that would drop
//!    the chain below `min_versions`; trash / tombstone stays allowed.
//!
//! 2. **Admin endpoints** (owner/admin only, app origin) to place / release /
//!    list legal holds and set / list retention policies. Each mutation is
//!    audited (`hold.placed`, `hold.released`, `retention.set`).
//!
//! Phase 1 is retain-only (D2): a permitted purge tombstones the file
//! (`files.trashed_at`) rather than erasing bytes — physical erasure lands in
//! Phase 4. The point of this layer is the enforcement gate.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use dochub_auth::AuthSession;
use dochub_db::{
    action, AuditRepo, Db, File, FileVersionsRepo, LegalHold, LegalHoldsRepo, NewAuditEvent,
    NewLegalHold, NewRetentionPolicy, RetentionPolicy, RetentionRepo, WorkspaceMemberRepo,
    WorkspaceRole,
};
use serde::{Deserialize, Serialize};

use crate::HttpState;

// ─── Guards (consulted by every destructive path) ────────────────────────

/// Active legal holds covering `file` (file → project → workspace). Empty when
/// nothing covers it. The guard: a non-empty result means the file may not be
/// tombstoned or purged.
pub(crate) async fn active_holds(db: &Db, file: &File) -> Result<Vec<LegalHold>, DbErr> {
    LegalHoldsRepo::new(db)
        .active_holds_for(file)
        .await
        .map_err(DbErr)
}

/// True when `file` is under at least one active legal hold.
pub(crate) async fn is_under_hold(db: &Db, file: &File) -> Result<bool, DbErr> {
    Ok(!active_holds(db, file).await?.is_empty())
}

/// True when the workspace retention policy blocks a *permanent purge* of
/// `file` — i.e. a version is still inside the `min_age_days` window, or the
/// purge would drop the chain below `min_versions`. Trash / tombstone is never
/// blocked by retention; only permanent purge is.
pub(crate) async fn retention_blocks_purge(db: &Db, file: &File) -> Result<bool, DbErr> {
    let Some(workspace_id) = file.workspace_id.as_deref() else {
        return Ok(false);
    };
    let Some(policy) = RetentionRepo::new(db)
        .active_for_workspace(workspace_id)
        .await
        .map_err(DbErr)?
    else {
        return Ok(false);
    };
    let chain = FileVersionsRepo::new(db)
        .list_chain(&file.id)
        .await
        .map_err(DbErr)?;
    if chain.is_empty() {
        // No committed history to retain.
        return Ok(false);
    }
    // `min_versions`: a purge removes every version, so any retained history with
    // a positive floor forbids it.
    if policy.min_versions.is_some_and(|n| n >= 1) {
        return Ok(true);
    }
    // `min_age_days`: block if any version is still inside the window.
    if let Some(days) = policy.min_age_days {
        if days > 0 {
            let cutoff =
                time::OffsetDateTime::now_utc() - time::Duration::days(days.clamp(0, i64::MAX));
            if chain.iter().any(|v| v.created_at > cutoff) {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

/// Opaque DB error wrapper for the guards, so callers can map it into their own
/// error type without depending on `DbError`'s shape.
#[derive(Debug)]
pub(crate) struct DbErr(pub(crate) dochub_db::DbError);

impl std::fmt::Display for DbErr {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

// ─── Admin endpoints error type ──────────────────────────────────────────

#[derive(Debug)]
pub(crate) enum ComplianceError {
    Forbidden,
    NotFound,
    Validation(String),
    Internal(String),
}

impl IntoResponse for ComplianceError {
    fn into_response(self) -> axum::response::Response {
        match self {
            Self::Forbidden => (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({"error": "owner or admin access required"})),
            )
                .into_response(),
            Self::NotFound => (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "not found"})),
            )
                .into_response(),
            Self::Validation(m) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(serde_json::json!({ "error": m })),
            )
                .into_response(),
            Self::Internal(m) => {
                tracing::error!(error = %m, "compliance handler internal");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(serde_json::json!({"error": "internal error"})),
                )
                    .into_response()
            }
        }
    }
}

/// Authorise a compliance mutation: a system admin, or an Owner of the target
/// workspace. Anyone else → 403.
async fn require_admin_or_owner(
    s: &HttpState,
    session: &AuthSession,
    workspace_id: &str,
) -> Result<(), ComplianceError> {
    if session.is_admin {
        return Ok(());
    }
    let role = WorkspaceMemberRepo::new(&s.db)
        .role_of(workspace_id, &session.user_id)
        .await
        .map_err(|e| ComplianceError::Internal(e.to_string()))?;
    if matches!(role, Some(WorkspaceRole::Owner)) {
        Ok(())
    } else {
        Err(ComplianceError::Forbidden)
    }
}

// ─── DTOs ────────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct HoldDto {
    id: String,
    workspace_id: String,
    target_kind: String,
    target_id: Option<String>,
    reason: String,
    placed_by: String,
    placed_at: String,
    released_at: Option<String>,
    active: bool,
}

impl From<LegalHold> for HoldDto {
    fn from(h: LegalHold) -> Self {
        let active = h.is_active();
        Self {
            id: h.id,
            workspace_id: h.workspace_id,
            target_kind: h.target_kind,
            target_id: h.target_id,
            reason: h.reason,
            placed_by: h.placed_by,
            placed_at: rfc3339(h.placed_at),
            released_at: h.released_at.map(rfc3339),
            active,
        }
    }
}

#[derive(Serialize)]
struct RetentionDto {
    id: String,
    workspace_id: String,
    scope: String,
    min_versions: Option<i64>,
    min_age_days: Option<i64>,
    mode: String,
    created_at: String,
}

impl From<RetentionPolicy> for RetentionDto {
    fn from(p: RetentionPolicy) -> Self {
        Self {
            id: p.id,
            workspace_id: p.workspace_id,
            scope: p.scope,
            min_versions: p.min_versions,
            min_age_days: p.min_age_days,
            mode: p.mode,
            created_at: rfc3339(p.created_at),
        }
    }
}

fn rfc3339(t: time::OffsetDateTime) -> String {
    t.format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

// ─── Legal holds ─────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct PlaceHoldBody {
    workspace_id: String,
    target_kind: String,
    #[serde(default)]
    target_id: Option<String>,
    reason: String,
}

async fn place_hold(
    State(s): State<HttpState>,
    session: AuthSession,
    Json(body): Json<PlaceHoldBody>,
) -> Result<(StatusCode, Json<HoldDto>), ComplianceError> {
    require_admin_or_owner(&s, &session, &body.workspace_id).await?;

    let kind = body.target_kind.trim();
    if !matches!(
        kind,
        dochub_db::target_kind::FILE
            | dochub_db::target_kind::PROJECT
            | dochub_db::target_kind::WORKSPACE
    ) {
        return Err(ComplianceError::Validation(
            "target_kind must be one of file, project, workspace".into(),
        ));
    }
    // File / project holds must name a target; a workspace hold covers the whole
    // workspace and carries no target_id.
    let target_id = match kind {
        dochub_db::target_kind::WORKSPACE => None,
        _ => {
            let id = body.target_id.as_deref().map_or("", str::trim);
            if id.is_empty() {
                return Err(ComplianceError::Validation(
                    "target_id is required for file/project holds".into(),
                ));
            }
            Some(id.to_string())
        }
    };
    let reason = body.reason.trim();
    if reason.is_empty() {
        return Err(ComplianceError::Validation("reason is required".into()));
    }

    let hold = LegalHoldsRepo::new(&s.db)
        .place(&NewLegalHold {
            workspace_id: body.workspace_id.clone(),
            target_kind: kind.to_string(),
            target_id,
            reason: reason.to_string(),
            placed_by: session.user_id.clone(),
        })
        .await
        .map_err(|e| ComplianceError::Internal(e.to_string()))?;

    AuditRepo::emit(
        &s.db,
        NewAuditEvent {
            actor_id: Some(session.user_id.clone()),
            actor_username: Some(session.username.clone()),
            action: action::HOLD_PLACED.into(),
            target_kind: Some(hold.target_kind.clone()),
            target_id: hold
                .target_id
                .clone()
                .or_else(|| Some(hold.workspace_id.clone())),
            target_name: None,
            ip_address: None,
            metadata: Some(format!(
                r#"{{"hold_id":{},"workspace_id":{},"scope":{}}}"#,
                json_str(&hold.id),
                json_str(&hold.workspace_id),
                json_str(&hold.target_kind),
            )),
        },
    );

    Ok((StatusCode::CREATED, Json(hold.into())))
}

async fn release_hold(
    State(s): State<HttpState>,
    session: AuthSession,
    Path(id): Path<String>,
) -> Result<Json<HoldDto>, ComplianceError> {
    let holds = LegalHoldsRepo::new(&s.db);
    let existing = holds
        .find_by_id(&id)
        .await
        .map_err(|e| ComplianceError::Internal(e.to_string()))?
        .ok_or(ComplianceError::NotFound)?;
    require_admin_or_owner(&s, &session, &existing.workspace_id).await?;

    let released = holds
        .release(&id)
        .await
        .map_err(|e| ComplianceError::Internal(e.to_string()))?
        .ok_or(ComplianceError::NotFound)?;

    AuditRepo::emit(
        &s.db,
        NewAuditEvent {
            actor_id: Some(session.user_id.clone()),
            actor_username: Some(session.username.clone()),
            action: action::HOLD_RELEASED.into(),
            target_kind: Some(released.target_kind.clone()),
            target_id: released
                .target_id
                .clone()
                .or_else(|| Some(released.workspace_id.clone())),
            target_name: None,
            ip_address: None,
            metadata: Some(format!(
                r#"{{"hold_id":{},"workspace_id":{}}}"#,
                json_str(&released.id),
                json_str(&released.workspace_id),
            )),
        },
    );

    Ok(Json(released.into()))
}

#[derive(Deserialize)]
struct ListHoldsQuery {
    workspace_id: String,
    #[serde(default)]
    active: bool,
}

#[derive(Serialize)]
struct HoldsResp {
    holds: Vec<HoldDto>,
}

async fn list_holds(
    State(s): State<HttpState>,
    session: AuthSession,
    Query(q): Query<ListHoldsQuery>,
) -> Result<Json<HoldsResp>, ComplianceError> {
    require_admin_or_owner(&s, &session, &q.workspace_id).await?;
    let rows = LegalHoldsRepo::new(&s.db)
        .list_for_workspace(&q.workspace_id, q.active)
        .await
        .map_err(|e| ComplianceError::Internal(e.to_string()))?;
    Ok(Json(HoldsResp {
        holds: rows.into_iter().map(HoldDto::from).collect(),
    }))
}

// ─── Retention ───────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct SetRetentionBody {
    workspace_id: String,
    #[serde(default)]
    scope: Option<String>,
    #[serde(default)]
    min_versions: Option<i64>,
    #[serde(default)]
    min_age_days: Option<i64>,
    #[serde(default)]
    mode: Option<String>,
}

async fn set_retention(
    State(s): State<HttpState>,
    session: AuthSession,
    Json(body): Json<SetRetentionBody>,
) -> Result<(StatusCode, Json<RetentionDto>), ComplianceError> {
    require_admin_or_owner(&s, &session, &body.workspace_id).await?;

    // Phase 1: workspace scope, retain mode only.
    let scope = body.scope.as_deref().map_or("workspace", str::trim);
    if scope != "workspace" {
        return Err(ComplianceError::Validation(
            "scope must be 'workspace' in Phase 1".into(),
        ));
    }
    let mode = body.mode.as_deref().map_or("retain", str::trim);
    if mode != "retain" {
        return Err(ComplianceError::Validation(
            "mode must be 'retain' in Phase 1".into(),
        ));
    }
    if body.min_versions.is_some_and(|n| n < 0) || body.min_age_days.is_some_and(|n| n < 0) {
        return Err(ComplianceError::Validation(
            "min_versions and min_age_days must be non-negative".into(),
        ));
    }

    let policy = RetentionRepo::new(&s.db)
        .set(&NewRetentionPolicy {
            workspace_id: body.workspace_id.clone(),
            scope: scope.to_string(),
            min_versions: body.min_versions,
            min_age_days: body.min_age_days,
            mode: mode.to_string(),
        })
        .await
        .map_err(|e| ComplianceError::Internal(e.to_string()))?;

    AuditRepo::emit(
        &s.db,
        NewAuditEvent {
            actor_id: Some(session.user_id.clone()),
            actor_username: Some(session.username.clone()),
            action: action::RETENTION_SET.into(),
            target_kind: Some("workspace".into()),
            target_id: Some(policy.workspace_id.clone()),
            target_name: None,
            ip_address: None,
            metadata: Some(format!(
                r#"{{"policy_id":{},"min_versions":{},"min_age_days":{}}}"#,
                json_str(&policy.id),
                policy
                    .min_versions
                    .map_or("null".to_string(), |n| n.to_string()),
                policy
                    .min_age_days
                    .map_or("null".to_string(), |n| n.to_string()),
            )),
        },
    );

    Ok((StatusCode::CREATED, Json(policy.into())))
}

#[derive(Deserialize)]
struct ListRetentionQuery {
    workspace_id: String,
}

#[derive(Serialize)]
struct RetentionResp {
    policies: Vec<RetentionDto>,
}

async fn list_retention(
    State(s): State<HttpState>,
    session: AuthSession,
    Query(q): Query<ListRetentionQuery>,
) -> Result<Json<RetentionResp>, ComplianceError> {
    require_admin_or_owner(&s, &session, &q.workspace_id).await?;
    let rows = RetentionRepo::new(&s.db)
        .list_for_workspace(&q.workspace_id)
        .await
        .map_err(|e| ComplianceError::Internal(e.to_string()))?;
    Ok(Json(RetentionResp {
        policies: rows.into_iter().map(RetentionDto::from).collect(),
    }))
}

/// Minimal JSON string escaper for the small identifiers we embed in audit
/// metadata (ULIDs + scope words — no user free-text goes through here).
fn json_str(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"\"".into())
}

pub(crate) fn router(state: HttpState) -> Router {
    Router::new()
        .route("/api/holds", get(list_holds).post(place_hold))
        .route("/api/holds/{id}", axum::routing::delete(release_hold))
        .route("/api/retention", post(set_retention).get(list_retention))
        .with_state(state)
}
