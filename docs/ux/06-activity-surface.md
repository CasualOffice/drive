# 06 — Activity / audit-trail surface

> Design system: `docs/design/ui-system.md` is canonical and supersedes the old
> tokens/commandments in `docs/research/04-polish-principles.md`. This surface is
> built from its components — **audit-trail row** (§7.4), **verification badge**
> (§7.5), **retention / legal-hold banner** (§7.7) — using its tokens, Lucide
> security glyph set (§6.2), and copy rules.

Companion to `02-surface.md` and `18-version-history-surface.md`. Defines the
in-app `/activity` feed and the underlying `audit_log`. In Doc-Hub the audit log
is **append-only and hash-chained** — a committed event is never updated or
deleted, and every row links to the previous by hash (inviolable rule 6). This
is the hub's compliance record, and it is **exportable and offline-verifiable**.

Where the version surface (`18`) proves a *document's* chain, this surface proves
the *hub's* chain: the same tamper-evident machinery, one level up.

## Pattern reference

**GitHub / Linear / Vercel** all use a chronological, day-grouped timeline with
one-line entries. We adopt the same shape — and Doc-Hub's density (ui-system §1.1,
32px rows) makes it tighter:

1. *Scannability* — admins flick through the feed during incidents; one-line
   append-only rows beat collapsed cards.
2. *Per-event extensibility* — each row carries an event-icon + metadata without
   breaking the 32px rhythm.
3. *Export fidelity* — the row shape maps 1:1 to the verifiable JSONL export.

## Tamper-evidence (the product, not a nice-to-have)

- Each `audit_log` row stores `content_hash = SHA-256(canonicalized row)` and
  `prev_hash` (the previous row's `content_hash`). The head is the newest event.
- `verify_audit_chain()` recomputes and links the chain end to end. A break is a
  **tamper alarm** — surfaced here (ui-system §7.5, §8.2), raised out-of-band to
  admins, and never silently repaired.
- No code path `UPDATE`s or `DELETE`s a committed audit row (inviolable rule 6).
  Enforced by construction and property-tested.

## Layout — audit trail (ui-system §7.4)

Append-only, day-grouped, hash-chained like versions. Never editable. Rows are
32px (§4.2); time, event-hash, and versions render **mono + tabular** (§3.3) so
columns align and hashes compare character-by-character.

```
┌ Activity ───────────────── shield-check Chain verified ──── [ Export ▼ ] ┐
│  Every action in this hub, newest first. Append-only · hash-chained.     │  --fg-subtle
│  [ Actor ▾ ] [ Action ▾ ] [ Date range ▾ ] [ Project ▾ ]                 │  filter bar (§7.4)
├──────────────────────────────────────────────────────────────────────────┤
│  ── Today ──────────────────────────────────────────────────────────     │
│  14:32  →   admin   signed in       —                       from 198.51.… │
│  14:31  ↑   admin   uploaded        Q2.xlsx            v1   28.4 KB  #… ⧉ │
│  14:30  ✎   admin   saved           Q2.xlsx            v2   #1a77…    ⧉  │  mono/tnum
│  14:29  🔗  admin   shared          Q2.xlsx                 expires 7d #… │
│  14:28  ⤴   admin   restored        Plan.docx        v3→v6  #10bd…    ⧉  │
│  ── Yesterday ──────────────────────────────────────────────────────      │
│  18:11  🔗  someone opened          Architecture.pdf        via Z3kQ…  #… │
│  09:04  ⚖   admin   placed hold     NDA.pdf                 #4e0a…    ⧉  │  --status-attention
├──────────────────────────────────────────────────────────────────────────┤
│  Append-only · hash-chained · 1,204 events                [ Load older ]  │  footer --fg-subtle
└──────────────────────────────────────────────────────────────────────────┘
```

Centered pane, 760px max (or full-width in Admin). `--radius-lg` panel, hairline
row separators (§5.3), zero shadow on the table (§5.2).

- **Row anatomy** (§7.4): `time (mono/tnum) · event-icon · actor · verb ·
  target · version · event-hash (mono) · copy`. **Verb-first**, present/past
  terse, sentence case (§1.15). Event hash truncated `#1a77…`, click-to-copy
  (`copy` glyph → toast "Hash copied"); full value in `aria-label` (§9.5).
- **Event icon** (Lucide §6.2): a single glyph per concept, `--fg-muted` at rest,
  status-colored only for integrity/hold events (each with its label so color is
  never alone, §9.2). Examples: `log-in`/`log-out` (auth), `upload` (upload),
  `pencil` (edit/save), `rotate-ccw` (restore), `link-2`/`share-2` (share),
  `gavel` (`--status-attention`, hold), `clock` (retention), `key-round` (keys),
  `badge-check` (provenance), `sparkles` (AI, read-only).
- **Time** renders in the **user's local timezone** (never UTC in the UI; stored
  UTC), mono/tabular. Full absolute timestamp + `prev_hash` on hover.
- **Version transitions are first-class**: `files.edit` / `files.restore` render
  `v3→v6` (mono/tnum) and the short `content_hash` prefix.
- **Day-group header**: `Today` / `Yesterday` / `Last 7 days` / relative
  `Wed, Jun 4`; absolute `MMM D, YYYY` past 30 days.
- **No mutating hover actions** — append-only (§7.4). Hover reveals full
  timestamp + `prev_hash` tooltip and a `⋯` exposing **Copy event JSON**
  (includes `content_hash`/`prev_hash` for forensic use). No row carries an edit
  or delete affordance; that would violate append-only.
- **Filter bar** (§7.4): actor, action, date range, project. Load-older
  paginates against the `next_before` cursor.

## Chain state — verified / tamper

The header carries the chain outcome as the two-variant **verification badge**
(ui-system §7.5) — icon + label, never color alone.

**Verified** (`verify_audit_chain` passes):

```
shield-check  Chain verified          fg=--status-verified, border-hair,
                                       transparent bg, 20px inline (§7.5)
```

Quiet by design — verified is the default state, so it reads calm (ui-system §8.1).

**Tamper** (a link breaks) replaces the badge with a persistent **block-level
alarm** at the top of the pane (ui-system §7.5, §8.2, principle 9):

```
┌──────────────────────────────────────────────────────────────────────────┐
│ shield-alert  Tamper detected  ·  Audit chain broke at 14:30 (event #1a77…). │
│    A committed row no longer matches its recorded hash. Reported to admins.  │
│    This cannot be dismissed until resolved.               [ View event ]     │
└──────────────────────────────────────────────────────────────────────────┘
  fg=--fg-default, icon=shield-alert --status-danger, bg rgba(163,44,34,0.08),
  left rule 3px --status-danger, --radius-md, 12px pad, role="alert" aria-live="assertive"
```

- Persists; cannot be dismissed without resolution. Names the failing event,
  raises the admin integrity alarm (`11-admin-surface.md`) and a bell entry
  (`10-bell-and-help.md`). **Never auto-repaired** — the break is the record.
- The export **flags** the break rather than hiding it (see Export).

## Event catalogue (v0)

Verb-first display sentences, sentence case. Actor is `—` when anonymous
(`share.access`) or system.

| Action | Actor | Target kind | Display (verb-first) |
|---|---|---|---|
| `setup.admin_created` | — | user | admin created — first-run setup completed |
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
| `files.trash` | user | file | *admin* moved *Q2.xlsx* to trash (tombstone) |
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

`share.access` deliberately has no actor (recipient is anonymous); the metadata
blob carries the share-link token. AI events record that the action was
read-only. `files.trash`, `holds.*`, `retention.*` are append-only tombstone /
lockout events (ui-system §7.7) — copy frames them as retained, not erased.

## Export

- **Export** (top-right; admin) → `GET /api/audit/export?after=…&before=…`.
  Rendered as the surface's single primary (amber, ui-system §7.9); inline
  spinner while streaming (§7.13).
- Formats: **JSONL** (one event per line, each with `content_hash`/`prev_hash`,
  plus a trailing manifest carrying the chain head and its Ed25519 signature) and
  a **PDF summary** for human review.
- The export **verifies offline**: a recipient recomputes each row's hash, checks
  links, and checks the head signature — no server call needed.
- Completion toast (sonner, §7.12): "Exported audit report · verifiable." If the
  chain is broken, the export **flags** the break rather than hiding it.

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
- Authed only. v0 returns the whole feed to every authed user; per-user/project
  scoping ships with RBAC (Phase 4).

### `GET /api/audit/export?after={iso8601}&before={iso8601}&format={jsonl|pdf}` (admin)

Streams the verifiable report. Admin-only; the request itself is audited.

## States checklist

| State | Required | Notes |
|---|---|---|
| Default (≥1 event) | yes | day-grouped 32px audit rows (§7.4) |
| Empty (zero events) | yes | "No activity yet." + `scroll-text` registry motif (§7.4, principle 12) |
| Loading | yes | 4 skeleton rows mirroring column widths (§7.13); no spinner |
| Error | yes | inline `aria-live` error band, never a blank feed |
| Chain verified | yes | header inline `shield-check` "Chain verified" badge (§7.5) |
| Chain broken (tamper) | yes | block-level alarm + admin alert; export flags it; not auto-cleared |
| Filtered | yes | filter bar active; filtered-empty state distinct from zero-events |
| Load older | yes | spinner-on-click; hides when `next_before` is null |
| Exporting | yes | inline spinner on Export; completion toast |

## Design-system conformance (§1 principles)

1. **Compliance surfaces are load-bearing** (8) — the audit trail gets the
   first-class §7.4 row + §7.5 badge treatment; every state designed.
2. **Tamper is an alarm** (9) — persistent block alarm, resolution-only, icon +
   label + remediation, `role="alert"` / `aria-live="assertive"`.
3. **Append-only is legible** (10, §8.6) — footer states "Append-only ·
   hash-chained"; no edit/delete affordance on any row; trash/hold framed as
   tombstone/lockout, not erasure.
4. **Density is the feature** (1) — 32px rows, tight rhythm; ~18 rows per 640px.
5. **Amber never alone** (3) — hold `gavel`, retention `clock`, tamper
   `shield-alert` each pair icon + label.
6. **Type carries hierarchy** (4) — verb > actor/target > time/hash; time and
   hashes render **mono + tabular** (§3.3).
7. **One primary per surface** (5) — Export is the sole primary; filters and
   copy are ghost/icon controls.
8. **Keyboard first** (11) — ↑/↓ move rows, `Enter` expands metadata, `/` focuses
   filter, `E` exports (admin), `C` copies the focused row's event JSON.
9. **One icon family** (14) — Lucide, 1.5px stroke, one glyph per concept.
10. **Reduced motion honored** (13) — skeleton shimmer and entrances collapse to
    opacity-only ≤50ms (§9.6).

## Out of scope (v0)

- Real-time push (SSE) — Phase 4.
- Per-project audit partitioning in the UI — arrives with RBAC (schema already
  supports the filter dimensions above).
- Saved / shareable filter views — Phase 4.
