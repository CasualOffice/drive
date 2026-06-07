# 14 — Real-time presence at the Drive level (Phase 3)

Drive-shell ambient awareness: *who else is here right now* (sidebar avatar stack), *who just renamed this folder* (toast), *which file someone else is viewing* (subtle dot in the row). Distinct from in-editor co-editing — Casual Sheet + Casual Document handle their own real-time collab through their own backends; Drive only knows "Alex has the editor open on Q2.xlsx".

## Why now

v0 ships single-tenant + workspace-membership-only. Phase 3 multi-user with OIDC turns workspaces into real teams. The moment two team members are in the same Drive at once, the lack of presence becomes noticeable: someone moves a file you were about to open and you have no idea who; you spend 5 minutes on a doc that someone else is already updating; you wonder if anyone's around to help.

The right amount of presence in v0.3 is **ambient, not intrusive**: a couple of pixels, no notifications, no presence indicator anywhere a user wasn't already looking.

## Locked decisions

### **Server-Sent Events, not WebSocket**

- Drive's traffic is overwhelmingly one-way: server → SPA notifies of presence changes.
- SSE survives reverse-proxies that block WS upgrades (still common on shared hosting).
- SSE rides existing HTTP/2 multiplexing.
- WebSocket is more flexible but the only bidirectional signal we'd need (heartbeat) is cheap as a periodic POST.
- Reconnect-on-disconnect is built into `EventSource` for free.
- One scenario WebSocket would win — sub-200ms cursor presence — is explicitly out of scope (Drive's not an editor).

### **One presence channel per workspace, not per file**

- The SPA opens `GET /api/presence/{workspace_id}` on first load + workspace switch.
- Server pushes events for everything happening in that workspace: opens, renames, trash, restore, file-currently-viewed signals.
- One stream is cheaper than N-per-file; client filters at render time.

### **Server-side state in-memory + Redis-shaped escape hatch**

- v0.3 ships an in-process `PresenceHub` (per-workspace `HashMap<user_id, PresenceEntry>`, expires after 60s of silence).
- For multi-instance Drive deployments (which don't exist yet but might), the same surface plugs into a Redis pub/sub channel. The trait + the in-process impl ship together; Redis lands when someone needs it.
- No SQL — presence is ephemeral; the audit log already records the durable record of every action.

### **Heartbeat from the SPA, not from the server**

- SPA POSTs `/api/presence/{workspace_id}/beat` every 25s while the tab is foregrounded.
- The hub expires entries after 60s of no heartbeat — gives one missed beat + a grace window.
- Backgrounded tab → no heartbeat → user fades from the presence avatar stack within a minute.
- Page navigation → an explicit `/leave` POST so the avatar drops immediately rather than waiting on timeout.

### **Avatar stack maxes at 5; "+N more" tooltip**

- The sidebar's workspace-switcher row gets a horizontal stack of avatar circles (initial monogram if no avatar uploaded).
- 5 visible + a +N count beats showing every avatar at small sizes.
- Order: most-recently-active first.
- Each avatar tooltip: `Alex · viewing Q2.xlsx · 14s ago` (or "idle" when no specific file).

### **File-row presence: one dot, no avatars**

- When someone is viewing a file (preview modal open, or editor handoff in progress), the row gets a 4px coloured dot in the corner, same colour as the avatar's monogram tint.
- Hover → "Alex".
- No avatars in the row — they'd be noisy and small.
- Folders never get presence dots (folders aren't really "viewed").

### **No "Alex is typing" / no cursor positions**

- Cursors are an editor concern. Casual Sheet's collaboration backend handles its own presence in-editor.
- Drive's job stops at "Alex has the editor open on this file" — Drive doesn't know what Alex is doing inside it.

## Locked-out decisions

- **WebSocket bidirectional channel.** SSE wins on simplicity + proxy compatibility. Re-evaluate if v0.4 wants real-time chat in Drive (which would need bidirectional anyway).
- **Per-file SSE streams.** N-per-file × M-users-per-workspace gets ugly fast.
- **Persistent presence history.** Audit log already records this for replay. Live presence is intentionally amnesic.
- **"Last seen 3 hours ago" indicators for inactive users.** Different feature, different psychology. v0.3 only shows currently-present users.
- **Notification toasts for every move.** Toast on rename/trash *of a file currently in your viewport*; silent otherwise. Don't spam.

## Threat model

| Risk | Mitigation |
|---|---|
| **Cross-workspace leak via SSE subscription** | The `/api/presence/{ws}` endpoint runs through `WorkspaceMemberRepo::role_of` before subscribing. Non-members get 403. |
| **Heartbeat spam DoS** | Per-user rate limit on `/beat` — 1 per 10s upper bound. SPA's 25s cadence is well under. |
| **Avatar URL injection** | Avatars are monograms rendered client-side from `username`. No uploaded image bytes ever flow through presence in v0.3. |
| **Presence info as a side channel** | Membership-gated, so non-members can't infer activity. The IdP knows who's in the workspace anyway. |
| **SSE-keepalive resource exhaustion** | Per-user cap of 5 concurrent SSE streams (covers tabs + windows). Beyond that, oldest is dropped. |

## Schema

No new tables. Presence is ephemeral. Optional `users.avatar_tint` column gets added so monogram avatars stay stable across renders (deterministic colour from `user_id` would also work; column lets users pick a tint later).

```sql
ALTER TABLE users ADD COLUMN avatar_tint TEXT;
```

## Endpoints

| Method | Path | Notes |
|---|---|---|
| `GET`  | `/api/presence/{workspace_id}` | SSE stream. `text/event-stream`. Sends `present`, `left`, `viewing`, `unviewing`, `action` events. |
| `POST` | `/api/presence/{workspace_id}/beat` | Heartbeat. Optional body `{ viewing?: <file_id \| null> }`. |
| `POST` | `/api/presence/{workspace_id}/leave` | Explicit goodbye (page navigation / sign out). |

Event payloads:

```json
// present
{ "type": "present", "user_id": "...", "username": "Alex", "tint": "#C8A45C", "viewing": "01H..." }

// viewing changed
{ "type": "viewing", "user_id": "...", "file_id": "01H..." }

// rename / trash / etc — reuses audit-event shape
{ "type": "action", "user_id": "...", "action": "files.rename", "target_id": "01H...", "target_name": "Q2 (renamed).xlsx" }
```

## SPA surface

Two visible affordances:

1. **Workspace switcher row** — an avatar stack of currently-present users (up to 5 + "+N more").
2. **File row dot** — 4px tinted dot in the corner of any file currently being viewed by another member.

Plus one quiet behaviour:

3. **Toast** — when a file currently in the user's grid/list is renamed, trashed, or moved by someone else: "Alex renamed Q2.xlsx → Q2 (final).xlsx" (3s, dismissable, no action button). Suppressed if the actor is the current user.

No notifications, no sound, no `Notifications` API permission ask.

## Implementation surface

Three modules + a frontend hook, ~600 LOC + tests:

- `crates/drive-http/src/presence.rs` (new): SSE handler + heartbeat + leave + the in-process `PresenceHub`.
- `crates/drive-http/src/state.rs`: `HttpState` gains `Arc<PresenceHub>`.
- Audit-emit middleware extension: when an audit event lands, the hub also publishes an `action` event to the relevant workspace channel.
- `web/src/state/PresenceContext.tsx` (new): wraps the EventSource lifecycle + exposes hooks (`usePresentUsers()`, `useViewingThisFile(file_id)`).

## Test plan

- Two-client roundtrip: client A opens SSE, client B beats → A sees `present` event.
- 60s timeout: A's stop heartbeating, B sees `left` event.
- Cross-workspace 403: non-member can't subscribe.
- Heartbeat rate-limit: 11 beats in 10s → 429.
- Action events: B renames a file → A's stream sees `action`.
- Reconnect: server kills stream → SPA EventSource reconnects + reissues `present`.

## Out of scope for v0.4

- Real-time chat inside Drive (would justify WebSocket).
- Cursor/typing-style indicators inside the file preview pane.
- @mentions, comments. Both deserve their own surface specs.
- Per-folder presence ("who else is browsing this folder right now").
- Read receipts.
