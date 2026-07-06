# 06 — Activity / audit-log surface

Companion to `02-surface-v2.md`. Defines the in-app `/activity` feed and the underlying `audit_log`. In Doc-Hub the audit log is **append-only and hash-chained** — a committed event is never updated or deleted, and every row links to the previous by hash. This surface is the compliance record, and it is **exportable and offline-verifiable**.

## Pattern reference

**GitHub / Linear / Vercel** all use a chronological, day-grouped timeline with one-line entries. We pick the same shape because:

1. *Scannability* — admins flick through the feed during incidents; one-line entries beat collapsed cards.
2. *Per-event extensibility* — each entry carries a badge + metadata blob without breaking rhythm.
3. *Export-friendliness* — the wire shape maps 1:1 to the verifiable JSONL export.

## Tamper-evidence (the product, not a nice-to-have)

- Each `audit_log` row stores `content_hash = SHA-256(canonicalized row)` and `prev_hash` (the previous row's `content_hash`). The head is the newest event.
- `verify_audit_chain()` recomputes and links the chain end-to-end. A break is a tamper alarm — surfaced here, raised out-of-band to admins, and never silently repaired.
- No code path `UPDATE`s or `DELETE`s a committed audit row (inviolable rule #6). This is enforced by construction and property-tested.

## Layout

```
┌─ Activity (centered pane, 760 px max, scrolls vertically) ───────────────┐
│                                                                          │
│   # Activity                          🛡 Chain verified   [ Export ▼ ]   │
│   Every action in this hub, newest first. Append-only and             │
│   tamper-evident.                                                        │
│   ────────────────────────────────────────────────────                  │
│                                                                          │
│   Today                                                                  │
│   ────────                                                              │
│   • 14:32   auth.sign_in     admin signed in            from 198.51.…   │
│   • 14:31   files.upload     admin uploaded Q2.xlsx (v1)  28.4 KB       │
│   • 14:30   files.edit       admin saved Q2.xlsx → v2     #1a77…        │
│   • 14:29   share.create     admin shared Q2.xlsx         expires 7 d   │
│   • 14:28   files.restore    admin restored Plan.docx v3 → v6           │
│                                                                          │
│   Yesterday                                                              │
│   ────────────                                                          │
│   • 18:11   share.access     someone opened Architecture.pdf  via Z3kQ… │
│   • 09:04   holds.place      admin placed a legal hold on NDA.pdf       │
│                                                                          │
│   [ Load older ]                                                         │
└──────────────────────────────────────────────────────────────────────────┘
```

Notes:

- **Chain-verified** badge (`shield-check`, `--success`) top-right when `verify_audit_chain` passes; a **tamper** banner (`alert-triangle`, `--danger`) replaces it on a break: **"Audit chain broke at 14:30. This has been reported to admins."**
- Day-group header: `Today` / `Yesterday` / `Last 7 days` / relative `Wed, Jun 4`; absolute `MMM D, YYYY` past 30 days.
- Each row is one line: `[hh:mm] [action-pill] [sentence] [metadata]`.
- Time renders in the **user's local timezone** (never UTC in the UI; stored UTC).
- Action pill uses category color: `auth.*` → ink, `files.*` → blue tint, `share.*` → gold tint, `holds.*`/`retention.*` → warning tint, `keys.*`/`ai.*`/`system.*` → muted.
- Version transitions are first-class: `files.edit` and `files.restore` render the `vN → vM` and a short `content_hash` prefix.
- Row hover reveals a ⋯ exposing **Copy event JSON** (includes `content_hash`/`prev_hash` for forensic use).
- Load-older paginates against the cursor from `/api/activity`.
- The feed is strictly read-only — no row has an edit or delete affordance (that would violate append-only).

## Event catalogue (v0)

| Action | Actor | Target kind | Display sentence |
|---|---|---|---|
| `setup.admin_created` | — | user | first-run setup completed — *admin* created |
| `auth.sign_in` | user | session | *admin* signed in |
| `auth.sign_in_failed` | — | user | sign-in failed for *username* |
| `auth.sign_out` | user | session | *admin* signed out |
| `auth.password_changed` | user | user | *admin* changed their password |
| `project.create` | user | project | *admin* created project *Compliance 2026* |
| `project.member_invited` | user | user | *admin* invited *sam* to *Compliance 2026* |
| `folders.create` | user | folder | *admin* created folder *Contracts* |
| `files.upload` | user | file | *admin* uploaded *Q2.xlsx* (v1) |
| `files.edit` | user | file | *admin* saved *Q2.xlsx* → v2 |
| `files.restore` | user | file | *admin* restored *Plan.docx* v3 → v6 |
| `files.rename` | user | file | *admin* renamed *Q2.xlsx* |
| `files.trash` | user | file | *admin* moved *Q2.xlsx* to trash |
| `files.open_in_editor` | user | file | *admin* opened *Q2.xlsx* in Casual Sheet |
| `share.create` | user | share_link | *admin* shared *Q2.xlsx* |
| `share.revoke` | user | share_link | *admin* revoked a share for *Q2.xlsx* |
| `share.access` | — | share_link | someone opened *Q2.xlsx* |
| `holds.place` | user | file/project | *admin* placed a legal hold on *NDA.pdf* |
| `holds.release` | user | file/project | *admin* released the legal hold on *NDA.pdf* |
| `retention.update` | user | project | *admin* set retention to 365 days on *Compliance 2026* |
| `keys.rotate_master` | user | system | *admin* rotated the master key |
| `provenance.issue` | user | file | *admin* issued a signed *Certificate.pdf* (v5) |
| `provenance.verify` | user | file | *admin* verified *Certificate.pdf* |
| `ai.query` | user | — | *admin* ran an AI query (read-only) |

`share.access` deliberately has no actor (the recipient is anonymous); the metadata blob carries the share-link token. AI events record that the action was read-only.

## Export

- **Export report** (top-right, admin) → `GET /api/audit/export?after=…&before=…`.
- Formats: **JSONL** (one event per line, each with `content_hash`/`prev_hash`, plus a trailing manifest carrying the chain head and its Ed25519 signature) and a **PDF summary** for human review.
- The export **verifies offline**: a recipient recomputes each row's hash, checks links, and checks the head signature — no server call needed.
- Toast on completion: **"Exported audit report (verifiable)."** If the chain is broken, the export flags the break rather than hiding it.

## Backend contract

### `GET /api/activity?before={iso8601}&limit={n}` (authed)

```json
{
  "events": [
    {
      "id": "01HK…",
      "created_at": "2026-06-06T14:30:11Z",
      "actor_id": "usr_…",
      "actor_username": "admin",
      "action": "files.edit",
      "target_kind": "file",
      "target_id": "f_…",
      "target_name": "Q2.xlsx",
      "ip_address": null,
      "metadata": "{\"from_version\":1,\"to_version\":2}",
      "content_hash": "1a77…",
      "prev_hash": "9f3c…"
    }
  ],
  "next_before": "2026-06-06T11:02:09Z",
  "chain_verified": true
}
```

- `limit` is server-clamped to `[1, 200]`, default 50.
- `next_before` is `null` at end of data.
- `chain_verified` reflects `verify_audit_chain` over the returned window.
- Authed only. v0 returns the whole feed to every authed user; per-user/project scoping ships with RBAC (Phase 4).

### `GET /api/audit/export?after={iso8601}&before={iso8601}&format={jsonl|pdf}` (admin)

Streams the verifiable report. Admin-only; the request itself is audited.

## State checklist

| | Required | Notes |
|---|---|---|
| Default (≥1 event) | yes | day-grouped timeline |
| Empty (zero events) | yes | "Nothing here yet." + helper |
| Loading | yes | 4 skeleton rows |
| Error | yes | inline `aria-live` band |
| Chain verified | yes | header badge |
| Chain broken (tamper) | yes | loud banner + admin alert; export flags it |
| Load older | yes | spinner-on-click; hides when `next_before` is null |
| Exporting | yes | inline spinner on the Export button |

## Out of scope (v0)

- Filter by event type / actor / date — Phase 4 (schema already supports it).
- Real-time push (SSE) — Phase 4.
- Per-project audit partitioning in the UI — arrives with RBAC.
