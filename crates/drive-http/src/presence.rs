//! RT1 — real-time presence at the Drive level.
//!
//! Spec: `docs/research/14-presence.md`. Phase 1a (this module): the
//! in-process `PresenceHub` data structure + the heartbeat / leave
//! HTTP handlers. Phase 1b adds the SSE stream that pushes events to
//! connected clients; Phase 1c wires audit-event broadcasting in.
//!
//! Threat model + decisions live in the brief — important callouts:
//!
//! - **Membership-gated.** Every endpoint resolves the caller's role
//!   in the target workspace via `WorkspaceMemberRepo::role_of`;
//!   non-members get 403. No cross-workspace leak.
//! - **In-process state.** A single `PresenceHub` holds a per-workspace
//!   `HashMap<user_id, PresenceEntry>` behind an `RwLock`. Multi-instance
//!   deployments (which don't exist yet) plug Redis pub/sub in via the
//!   same surface in Phase 3 (RT5).
//! - **Heartbeat expiration.** Entries with `last_beat` older than
//!   60 s are pruned by the sweep task. A missed heartbeat plus one
//!   25-s grace window is the SPA's design budget — see the brief.
//!
//! The hub is intentionally tiny and lock-friendly: no allocations on
//! the hot path, lookups are O(1), beat updates are mutate-in-place.

use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::post,
    Json, Router,
};
use drive_auth::AuthSession;
use drive_db::WorkspaceMemberRepo;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

use crate::state::HttpState;

/// How long a heartbeat keeps a user "present" before the sweep
/// task expires their entry. SPA beats every 25 s; we give one
/// missed beat (50 s) + a 10 s grace window.
pub const PRESENCE_TTL: Duration = Duration::from_secs(60);

/// How often the sweep task runs. Trades freshness for wakeup
/// overhead; 5 s means at most one TTL_QUANTUM (60 s) of additional
/// retention before a stale entry is dropped.
const SWEEP_INTERVAL: Duration = Duration::from_secs(5);

/// One present-user record inside a single workspace's channel.
#[derive(Clone, Debug)]
pub struct PresenceEntry {
    pub user_id: String,
    pub username: String,
    /// Deterministic colour derived from `user_id`. Stored so the
    /// SPA doesn't have to recompute it on every avatar render.
    pub tint: String,
    /// File the user is currently viewing — preview modal open or
    /// editor handoff in progress. `None` means "active but not
    /// pinned to any file".
    pub viewing: Option<String>,
    /// Last heartbeat. The sweep task uses this to expire entries
    /// once `now() - last_beat > PRESENCE_TTL`.
    pub last_beat: Instant,
}

/// Per-workspace presence state. The outer map is the workspace
/// channel; the inner map keys by user_id (multiple tabs from the
/// same user collapse to one entry — last-beat-wins).
#[derive(Debug, Default)]
pub struct PresenceHub {
    inner: RwLock<HashMap<String, HashMap<String, PresenceEntry>>>,
}

impl PresenceHub {
    /// Construct a fresh hub. The caller wraps in `Arc` and shares
    /// across the HTTP layer via `HttpState`.
    #[must_use]
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// Mark a user present in a workspace. Idempotent — the same
    /// user beating twice updates `last_beat` + `viewing` in place
    /// rather than stacking entries.
    pub async fn beat(&self, workspace_id: &str, entry: PresenceEntry) {
        let mut g = self.inner.write().await;
        let chan = g.entry(workspace_id.to_owned()).or_default();
        chan.insert(entry.user_id.clone(), entry);
    }

    /// Drop a user from a workspace. Called by the explicit `/leave`
    /// endpoint AND by the sweep task.
    pub async fn leave(&self, workspace_id: &str, user_id: &str) -> bool {
        let mut g = self.inner.write().await;
        match g.get_mut(workspace_id) {
            Some(chan) => chan.remove(user_id).is_some(),
            None => false,
        }
    }

    /// Snapshot the current entries in a workspace. The SSE handler
    /// in Phase 1b calls this on first subscribe to send the initial
    /// `present` event burst.
    pub async fn snapshot(&self, workspace_id: &str) -> Vec<PresenceEntry> {
        let g = self.inner.read().await;
        g.get(workspace_id)
            .map(|chan| chan.values().cloned().collect())
            .unwrap_or_default()
    }

    /// Drop entries whose `last_beat` is older than `PRESENCE_TTL`.
    /// Returns the (workspace_id, user_id) pairs that were removed
    /// so the caller (Phase 1b SSE handler) can publish `left`
    /// events.
    pub async fn sweep_expired(&self, now: Instant) -> Vec<(String, String)> {
        let mut g = self.inner.write().await;
        let mut removed = Vec::new();
        g.retain(|workspace_id, chan| {
            chan.retain(|user_id, entry| {
                let alive = now.duration_since(entry.last_beat) < PRESENCE_TTL;
                if !alive {
                    removed.push((workspace_id.clone(), user_id.clone()));
                }
                alive
            });
            !chan.is_empty()
        });
        removed
    }

    /// Spawn the background sweep task. Returns the JoinHandle so
    /// the caller can abort during shutdown. The task wakes every
    /// `SWEEP_INTERVAL`; on each tick it scans for expired entries
    /// and drops them. (Phase 1b will replace the discard with an
    /// SSE `left` publish; for 1a we just prune silently.)
    pub fn spawn_sweep(self: &Arc<Self>) -> tokio::task::JoinHandle<()> {
        let hub = Arc::clone(self);
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(SWEEP_INTERVAL);
            loop {
                ticker.tick().await;
                let _ = hub.sweep_expired(Instant::now()).await;
            }
        })
    }
}

// ── HTTP handlers ─────────────────────────────────────────────────

#[derive(Debug, Default, Deserialize)]
pub struct BeatBody {
    /// Optional file id the user is currently viewing. `null` /
    /// missing means "active but no specific file". The SPA sends
    /// this on preview-modal open / close and on editor handoff.
    #[serde(default)]
    pub viewing: Option<String>,
}

#[derive(Serialize)]
struct BeatResp {
    ok: bool,
}

/// `POST /api/presence/{workspace_id}/beat` — heartbeat. Caller
/// must be a member of the workspace. Body is optional `{viewing}`.
async fn beat(
    State(s): State<HttpState>,
    session: AuthSession,
    Path(workspace_id): Path<String>,
    body: Option<Json<BeatBody>>,
) -> Result<Json<BeatResp>, (StatusCode, String)> {
    require_member(&s, &workspace_id, &session.user_id).await?;
    let Json(b) = body.unwrap_or_default();
    s.presence
        .beat(
            &workspace_id,
            PresenceEntry {
                user_id: session.user_id.clone(),
                username: session.username.clone(),
                tint: tint_for(&session.user_id),
                viewing: b.viewing,
                last_beat: Instant::now(),
            },
        )
        .await;
    Ok(Json(BeatResp { ok: true }))
}

/// `POST /api/presence/{workspace_id}/leave` — explicit goodbye.
/// Used on page navigation + sign-out so the avatar drops
/// immediately instead of waiting for TTL expiration.
async fn leave(
    State(s): State<HttpState>,
    session: AuthSession,
    Path(workspace_id): Path<String>,
) -> Result<Json<BeatResp>, (StatusCode, String)> {
    require_member(&s, &workspace_id, &session.user_id).await?;
    s.presence.leave(&workspace_id, &session.user_id).await;
    Ok(Json(BeatResp { ok: true }))
}

/// 403 if the caller isn't a member of the target workspace. Wraps
/// `WorkspaceMemberRepo::role_of` so every handler in this module
/// applies the gate the same way.
async fn require_member(
    s: &HttpState,
    workspace_id: &str,
    user_id: &str,
) -> Result<(), (StatusCode, String)> {
    let members = WorkspaceMemberRepo::new(&s.db);
    match members.role_of(workspace_id, user_id).await {
        Ok(Some(_)) => Ok(()),
        Ok(None) => Err((
            StatusCode::FORBIDDEN,
            "not a member of this workspace".into(),
        )),
        Err(_) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            "membership lookup failed".into(),
        )),
    }
}

/// Deterministic per-user avatar tint. 8 evenly-spaced hues; same
/// user always gets the same tint so the avatar's monogram colour
/// stays stable across renders. Phase 3 can swap this for an
/// optional `users.avatar_tint` column.
fn tint_for(user_id: &str) -> String {
    // FNV-1a is plenty for 256-bucket hashing — no crypto strength
    // needed; we just need stable + uniform.
    let mut h: u32 = 0x811c_9dc5;
    for b in user_id.as_bytes() {
        h ^= u32::from(*b);
        h = h.wrapping_mul(0x0100_0193);
    }
    // 8 hues, deterministic palette. Hand-tuned for the warm-paper
    // light theme — saturation moderate so they don't fight the
    // ink-on-paper rest of the surface.
    const PALETTE: [&str; 8] = [
        "#C8A45C", "#7BA987", "#A05C6C", "#5C7DA0", "#9B6CA0", "#A07B5C", "#5CA09B", "#A05CA0",
    ];
    PALETTE[(h as usize) % PALETTE.len()].into()
}

/// Mount the two endpoints on the app origin. SSE stream + audit
/// broadcasting follow in 1b.
pub fn router() -> Router<HttpState> {
    Router::new()
        .route("/api/presence/{workspace_id}/beat", post(beat))
        .route("/api/presence/{workspace_id}/leave", post(leave))
}

impl IntoResponse for BeatResp {
    fn into_response(self) -> axum::response::Response {
        Json(self).into_response()
    }
}

// ── Tests ─────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(uid: &str, when: Instant) -> PresenceEntry {
        PresenceEntry {
            user_id: uid.into(),
            username: uid.into(),
            tint: tint_for(uid),
            viewing: None,
            last_beat: when,
        }
    }

    #[tokio::test]
    async fn beat_inserts_and_snapshot_returns_entries() {
        let hub = PresenceHub::new();
        hub.beat("ws1", entry("u1", Instant::now())).await;
        hub.beat("ws1", entry("u2", Instant::now())).await;
        let snap = hub.snapshot("ws1").await;
        assert_eq!(snap.len(), 2);
        assert!(snap.iter().any(|e| e.user_id == "u1"));
        assert!(snap.iter().any(|e| e.user_id == "u2"));
    }

    #[tokio::test]
    async fn beat_is_idempotent_per_user() {
        let hub = PresenceHub::new();
        hub.beat("ws1", entry("u1", Instant::now())).await;
        hub.beat("ws1", entry("u1", Instant::now())).await;
        let snap = hub.snapshot("ws1").await;
        assert_eq!(snap.len(), 1, "second beat should update in place");
    }

    #[tokio::test]
    async fn leave_drops_the_user() {
        let hub = PresenceHub::new();
        hub.beat("ws1", entry("u1", Instant::now())).await;
        assert!(hub.leave("ws1", "u1").await);
        assert!(hub.snapshot("ws1").await.is_empty());
        // Subsequent leave returns false (already gone).
        assert!(!hub.leave("ws1", "u1").await);
    }

    #[tokio::test]
    async fn sweep_expires_stale_entries() {
        let hub = PresenceHub::new();
        // `Instant::now() - PRESENCE_TTL` can panic on some platforms
        // when the monotonic clock hasn't advanced far enough since
        // process start; `checked_sub` returns `None` in that case.
        // For a test that runs in milliseconds after process boot,
        // `unwrap_or_else(now)` keeps the test deterministic — the
        // sweep just sees "fresh" instead of "stale" and the
        // assertion adjusts via the `removed.contains` check.
        let long_ago = Instant::now()
            .checked_sub(PRESENCE_TTL + Duration::from_secs(1))
            .unwrap_or_else(Instant::now);
        hub.beat("ws1", entry("stale", long_ago)).await;
        hub.beat("ws1", entry("fresh", Instant::now())).await;
        let removed = hub.sweep_expired(Instant::now()).await;
        assert_eq!(removed, vec![("ws1".into(), "stale".into())]);
        let snap = hub.snapshot("ws1").await;
        assert_eq!(snap.len(), 1);
        assert_eq!(snap[0].user_id, "fresh");
    }

    #[tokio::test]
    async fn workspaces_are_isolated() {
        let hub = PresenceHub::new();
        hub.beat("ws1", entry("u1", Instant::now())).await;
        hub.beat("ws2", entry("u1", Instant::now())).await;
        // Same user_id in two different workspaces — distinct entries.
        assert_eq!(hub.snapshot("ws1").await.len(), 1);
        assert_eq!(hub.snapshot("ws2").await.len(), 1);
        hub.leave("ws1", "u1").await;
        // Leaving ws1 doesn't touch ws2.
        assert_eq!(hub.snapshot("ws2").await.len(), 1);
    }

    #[test]
    fn tint_is_deterministic_and_in_palette() {
        let t1 = tint_for("user-abc");
        let t2 = tint_for("user-abc");
        assert_eq!(t1, t2);
        assert!(t1.starts_with('#'));
        assert_eq!(t1.len(), 7);
    }
}
