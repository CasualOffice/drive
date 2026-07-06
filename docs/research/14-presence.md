# 14 — Real-time presence for team documents (Phase 3)

Doc-Hub-shell ambient awareness *and* the on-ramp to co-editing: *who else is in this project right now* (sidebar avatar stack), *who just renamed this folder* (toast), *who is co-editing this document* (a live indicator on the row that hands off into the embedded editor). Two layers, one feature:

- **Shell presence (this brief):** coarse, ambient, workspace-scoped, over SSE. "Alex has the editor open on Q2.xlsx." Cheap pixels, no notifications.
- **In-editor co-editing presence (the `collab` server, `01-wopi.md`):** fine-grained cursors, selections, who-is-typing, inside the embedded Sheet/Docs/PDF editor, over the Yjs/Hocuspocus channel.

The shell layer is the discovery + join surface for the editor layer: it tells you a teammate is already co-editing a document, and clicking through drops you into the same `collab` session. Doc-Hub knows *that* Alex is co-editing Q2.xlsx; the collab server knows *where Alex's cursor is*. Keeping the two separate keeps the shell stream cheap and the cursor stream in the editor where it belongs.

## Why now

v0 ships single-tenant + workspace-membership-only. Phase 3 multi-user with OIDC turns workspaces into real teams, and Phase 2's embedded editors turn documents into co-edited surfaces. The moment two members are in the same project — or the same document — the lack of presence bites: someone moves a document you were about to open and you have no idea who; you start editing a spreadsheet a teammate is already co-editing and don't notice until you both save; you wonder if anyone's around.

The right amount of presence is **ambient at the shell, rich inside the editor**: a couple of pixels in the Doc-Hub UI, real cursors once you're co-editing.

## Locked decisions

### **Server-Sent Events for shell presence, not WebSocket**

- Shell traffic is overwhelmingly one-way: server → SPA notifies of presence + co-editing changes.
- SSE survives reverse-proxies that block WS upgrades (still common on shared hosting).
- SSE rides existing HTTP/2 multiplexing; `EventSource` reconnects for free.
- The only bidirectional signal the shell needs (heartbeat) is cheap as a periodic POST.
- The genuinely bidirectional, sub-200ms channel — cursor co-editing — is **not** the shell's job; it runs on the `collab` server's WebSocket, purpose-built for it. The shell doesn't reinvent that.

### **One presence channel per workspace, not per document**

- The SPA opens `GET /api/presence/{workspace_id}` on first load + workspace switch.
- Server pushes everything happening in that workspace: opens, renames, trash, restore, and **co-editing signals** (who has which document open in an embedded editor).
- One stream is cheaper than N-per-document; client filters at render time.
- When a user actually opens a document in the embedded editor, cursor-level presence moves to that document's `collab` room — a separate, per-document channel owned by the editor, not the shell.

### **Server-side state in-memory + Redis-shaped escape hatch**

- v0.3 ships an in-process `PresenceHub` (per-workspace `HashMap<user_id, PresenceEntry>`, expires after 60s of silence).
- Multi-instance Doc-Hub deployments plug the same surface into a Redis pub/sub channel; the trait + in-process impl ship together, Redis lands when needed. The `collab` server has its own horizontal-scale story and is out of scope here.
- No SQL — shell presence is ephemeral; the append-only audit log is the durable record of every action.

### **Heartbeat from the SPA, not from the server**

- SPA POSTs `/api/presence/{workspace_id}/beat` every 25s while the tab is foregrounded, optionally carrying `{ viewing | editing: <file_id> }`.
- The hub expires entries after 60s of no heartbeat — one missed beat + grace.
- Backgrounded tab → no heartbeat → user fades within a minute.
- Page navigation / editor close → explicit `/leave` POST so the indicator drops immediately.

### **Avatar stack maxes at 5; "+N more" tooltip**

- The sidebar's workspace-switcher row gets a horizontal stack of avatar circles (initial monogram if no avatar uploaded).
- 5 visible + a +N count beats showing every avatar at small sizes.
- Order: most-recently-active first.
- Each tooltip: `Alex · editing Q2.xlsx · 14s ago` (or `viewing …`, or "idle").

### **Document-row presence: a co-editing indicator, not just a dot**

- When someone has a **document** open in the embedded editor, its row shows a small tinted indicator (same colour as the avatar's monogram tint) marked as *editing* — distinct from a passive *viewing* dot.
- Hover → "Alex is editing" (or "viewing"). Clicking a document with active co-editors opens the same embedded editor and joins the existing `collab` session.
- A plain 4px dot still marks passive viewing (preview open, no edit).
- Folders never get presence indicators (folders aren't "viewed").

### **Cursors and selections stay in the editor**

- Cursor positions, selections, and "Alex is typing" are the embedded editor's concern, carried by the `collab` server inside the document's Yjs room — never on the shell SSE stream.
- The shell's job stops at "Alex is co-editing this document." Once you're in the editor, the collab server takes over. This is the same division as in `01-wopi.md`: Doc-Hub handles the handoff + coarse presence; the editor + collab server handle real-time co-editing.

## Locked-out decisions

- **WebSocket for the shell channel.** SSE wins on simplicity + proxy compatibility for coarse presence. Real-time co-editing already has its WebSocket — the collab server — so the shell doesn't need one.
- **Per-document shell SSE streams.** N-per-document × M-users gets ugly; the per-document real-time channel is the collab room, not a second SSE stream.
- **Persistent presence history.** Audit log already records this. Live presence is intentionally amnesic.
- **"Last seen 3 hours ago" indicators.** Different feature, different psychology. v0.3 shows only currently-present users.
- **Notification toasts for every move.** Toast on rename/trash *of a document currently in your viewport*; silent otherwise.

## Threat model

| Risk | Mitigation |
|---|---|
| **Cross-workspace leak via SSE subscription** | `/api/presence/{ws}` runs through `WorkspaceMemberRepo::role_of` before subscribing. Non-members get 403. Joining a `collab` room is separately gated by a per-document editor access token (`01-wopi.md`). |
| **Heartbeat spam DoS** | Per-user rate limit on `/beat` — 1 per 10s upper bound. SPA's 25s cadence is well under. |
| **Avatar URL injection** | Avatars are monograms rendered client-side from `username`. No uploaded image bytes flow through presence in v0.3. |
| **Presence as a side channel** | Membership-gated; non-members can't infer activity. The IdP knows workspace membership anyway. Presence never leaks document *content* — it names the document, not its bytes. |
| **SSE-keepalive resource exhaustion** | Per-user cap of 5 concurrent SSE streams (tabs + windows). Beyond that, oldest is dropped. |

## Schema

No new tables. Shell presence is ephemeral. Optional `users.avatar_tint` column so monogram avatars stay stable across renders (a deterministic colour from `user_id` would also work; the column lets users pick a tint later).

```sql
ALTER TABLE users ADD COLUMN avatar_tint TEXT;
```

## Endpoints

| Method | Path | Notes |
|---|---|---|
| `GET`  | `/api/presence/{workspace_id}` | SSE stream. `text/event-stream`. Sends `present`, `left`, `viewing`, `editing`, `unviewing`, `action` events. |
| `POST` | `/api/presence/{workspace_id}/beat` | Heartbeat. Optional body `{ viewing?: <file_id> , editing?: <file_id> }`. |
| `POST` | `/api/presence/{workspace_id}/leave` | Explicit goodbye (navigation / editor close / sign out). |

Event payloads:

```json
// present
{ "type": "present", "user_id": "...", "username": "Alex", "tint": "#C8A45C", "editing": "01H..." }

// editing state changed (opened the embedded editor on a document)
{ "type": "editing", "user_id": "...", "file_id": "01H..." }

// rename / trash / etc — reuses audit-event shape
{ "type": "action", "user_id": "...", "action": "files.rename", "target_id": "01H...", "target_name": "Q2 (renamed).xlsx" }
```

## SPA surface

Two visible affordances plus one quiet behaviour:

1. **Workspace switcher row** — an avatar stack of currently-present users (up to 5 + "+N more"), tooltip showing viewing/editing state.
2. **Document-row indicator** — a tinted *editing* marker (or a passive *viewing* dot) on any document another member currently has open; click to join the embedded co-editing session.
3. **Toast** — when a document currently in the user's grid/list is renamed, trashed, or moved by someone else: "Alex renamed Q2.xlsx → Q2 (final).xlsx" (3s, dismissable). Suppressed if the actor is the current user.

No notifications, no sound, no `Notifications` API permission ask.

## Implementation surface

Three modules + a frontend hook, ~600 LOC + tests:

- `crates/dochub-http/src/presence.rs` (new): SSE handler + heartbeat + leave + the in-process `PresenceHub`.
- `crates/dochub-http/src/state.rs`: `HttpState` gains `Arc<PresenceHub>`.
- Audit-emit middleware extension: when an audit event lands, the hub also publishes an `action` event to the relevant workspace channel.
- `web/src/state/PresenceContext.tsx` (new): wraps the EventSource lifecycle + exposes hooks (`usePresentUsers()`, `useEditorsOf(file_id)`), and, on join, bridges into the embedded editor's `collab` session.

## Test plan

- Two-client roundtrip: A opens SSE, B beats → A sees `present`.
- Editing signal: B opens the embedded editor on a document → A's stream sees `editing`; A clicking through joins the same `collab` room (both saves land as ordered versions — cross-check UC-5 in `TESTING.md`).
- 60s timeout: A stops heartbeating → B sees `left`.
- Cross-workspace 403: non-member can't subscribe.
- Heartbeat rate-limit: 11 beats in 10s → 429.
- Action events: B renames a document → A's stream sees `action`.
- Reconnect: server kills stream → SPA `EventSource` reconnects + reissues `present`.

## Out of scope for v0.4

- Real-time chat inside Doc-Hub (would justify a dedicated WebSocket).
- Surfacing cursor/typing indicators at the shell (they stay in the editor + collab server).
- @mentions, comments — their own surface specs.
- Per-folder presence ("who else is browsing this folder").
- Read receipts.
