//! `GET /api/activity` — paginated audit-log feed.
//!
//! Spec: docs/ux/06-activity-surface.md.

use axum::{
    extract::{Query, State},
    Json,
};
use dochub_auth::AuthSession;
use dochub_db::{AuditEvent, AuditRepo};
use serde::{Deserialize, Serialize};

use crate::HttpState;

#[derive(Deserialize)]
pub(crate) struct ActivityQuery {
    /// RFC-3339 cursor — return events strictly older than this timestamp.
    /// Omit on first page.
    pub before: Option<String>,
    /// Page size. Clamped to [1, 200] server-side, default 50.
    pub limit: Option<i64>,
}

#[derive(Serialize)]
pub(crate) struct EventDto {
    pub id: String,
    pub created_at: String,
    pub actor_id: Option<String>,
    pub actor_username: Option<String>,
    pub action: String,
    pub target_kind: Option<String>,
    pub target_id: Option<String>,
    pub target_name: Option<String>,
    pub ip_address: Option<String>,
    pub metadata: Option<String>,
}

#[derive(Serialize)]
pub(crate) struct ActivityResp {
    pub events: Vec<EventDto>,
    pub next_before: Option<String>,
}

impl From<AuditEvent> for EventDto {
    fn from(e: AuditEvent) -> Self {
        Self {
            id: e.id,
            created_at: e
                .created_at
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default(),
            actor_id: e.actor_id,
            actor_username: e.actor_username,
            action: e.action,
            target_kind: e.target_kind,
            target_id: e.target_id,
            target_name: e.target_name,
            ip_address: e.ip_address,
            metadata: e.metadata,
        }
    }
}

pub(crate) async fn list_activity(
    State(s): State<HttpState>,
    _session: AuthSession,
    Query(q): Query<ActivityQuery>,
) -> Result<Json<ActivityResp>, axum::http::StatusCode> {
    let limit = q.limit.unwrap_or(50).clamp(1, 200);
    let events = AuditRepo::new(&s.db)
        .list(q.before.as_deref(), limit)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "audit list failed");
            axum::http::StatusCode::INTERNAL_SERVER_ERROR
        })?;
    // Cursor for the next page is the oldest entry's timestamp when we
    // filled the page; otherwise we're at the end.
    let next_before = if events.len() as i64 == limit {
        events.last().map(|e| {
            e.created_at
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default()
        })
    } else {
        None
    };
    Ok(Json(ActivityResp {
        events: events.into_iter().map(EventDto::from).collect(),
        next_before,
    }))
}
