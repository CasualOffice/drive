# 18 — Version history surface

> Design system: `docs/design/ui-system.md` is canonical and supersedes the old
> tokens/commandments in `docs/research/04-polish-principles.md`. This surface is
> built from its components — **version-history timeline + hash-chain
> visualization** (§7.3), **verification badge** (§7.5), **provenance /
> signature card** (§7.8), **retention / legal-hold banner** (§7.7) — using its
> tokens, Lucide security glyph set (§6.2), and copy rules.

Companion to `02-surface.md`, `10-sdk-integration-plan.md` (what a save
produces), `11-admin-surface.md` (retention / legal hold / integrity), and
`docs/ARCHITECTURE.md` §"Immutable version + hash-chain engine".

**This is Doc-Hub's flagship compliance surface.** Everything the registry
promises — a history you can *prove* and can't rewrite — is made legible here:
the literal hash chain, per-link verify/tamper state, additive restore, and
exportable provenance. Trust is shown, not stated (ui-system principle 8).

## What it renders

For a document, the append-only chain from `file_versions`:

```
file_versions(file_id, seq, storage_key, size, content_hash, prev_hash, author_id, reason, created_at)
```

Each version is one node on the timeline: sequence, author, timestamp, size
delta, an optional `reason`, and the `content_hash` → `prev_hash` link to its
predecessor. The head (highest `seq`) is the current document. Nothing here is
ever mutated or removed — restore and tombstone are additive (ui-system
principle 10; append-only invariant, inviolable rule 6).

## Opening it

- Kebab / context menu on a document → "Version history"; keyboard `H` on the
  focused row. `⌘K` → "Version history".
- Inside the editor, a `history` affordance in the chrome docks the same surface
  as a **360px right panel** over the editor (ui-system §4.3, §7.3).
- Route: `/document/{id}/history` (shareable within the project; membership-gated).

The surface renders in two forms from one component: the **360px right-docked
panel** (default, over table or editor) and a **full-width review view** (route
load) that adds the diff pane on the right. The chain column is identical in both.

## Layout — chain timeline (ui-system §7.3)

Newest at top, matching the logo stack (newest sheet forward). The vertical
connector *is* the chain: a verified segment renders `git-commit-horizontal` +
`link` in `--status-verified`; a broken segment renders `unlink` in
`--status-danger` with a persistent inline alert.

```
┌ Version history — Q3-roadmap.docx ───────────────────── [ Verify chain ] ┐
│                                                                          │
│  ●  v7  current            2h ago · Alex                                 │
│  │       reason: "quarter close numbers"                                │
│  │       content_hash  9f2c…a1  ⧉                          [Restore ⤴]  │  mono/tnum
│  │       shield-check  link intact                                       │  --status-verified
│  ┿  ← link verified                                                      │
│  ○  v6                     yesterday · Sam                               │
│  │       content_hash  4b8e…7d  ⧉   prev 71bd…8e                        │
│  │       shield-check  link intact                                       │
│  ┿                                                                       │
│  ○  v5                     Jul 2 · Alex     ⚖ hold                       │  --status-attention
│  │       content_hash  71bd…8e  ⧉   prev 3a10…04                        │
│  ┿                                                                       │
│  ○  v4                     Jun 30 · Alex                                 │
│  ┋                                                                       │
│  ── Tombstoned (retained) ────────────────────────────── archive ──     │  --fg-subtle
│  ○  v1  origin             Jun 25 · Alex                                 │
│                                                                          │
├──────────────────────────────────────────────────────────────────────── ┤
│  Chain: 7 versions · shield-check 6 links verified · Export ⧉           │  footer
│  Append-only · hash-chained                                             │  --fg-subtle
└──────────────────────────────────────────────────────────────────────── ┘
```

- **Node.** Filled `●` = current head, hollow `○` = prior (Lucide
  `git-commit-horizontal`). Version label `v7` in **mono, tabular** (§3.3),
  `--fg-muted`. Author + relative time in `--text-xs`/`--fg-subtle`; absolute
  timestamp on hover. Truncated `reason` in `--text-sm`.
- **Hashes.** `content_hash` / `prev_hash` render **mono + tabular**, truncated
  `9f2c…a1`, click-to-copy (`copy` glyph, toast "Hash copied"). Full 64-char
  value in the hover tooltip and in the `aria-label` (§9.5) — never only the
  truncated visual.
- **Link markers.** Between nodes, the connector carries the per-link state:
  `shield-check` + "link intact" (`--status-verified`) or, on a break, `unlink`
  + "LINK BROKEN" (`--status-danger`) with a persistent inline alert (see
  Integrity). Icon + label always both present — never color alone
  (ui-system principle 3 / §9.2).
- **Legal-hold marker.** A version under an active hold carries the `gavel`
  chip + "hold" in `--status-attention` (ui-system §7.7). Operations that would
  violate the hold are *absent* from that node's menu, not greyed.
- **Tombstoned (retained).** Versions past a tombstone marker group under an
  `archive`-glyphed divider, `--fg-subtle`, still listed — bytes retained under
  hold/retention, never hidden. The history is complete or it isn't a registry.

Density follows §4.2: node/row rhythm on the 32px grid, 12px cell pad-x,
`--radius-lg` (10px) panel, hairline separators (§5.3). No shadow on the docked
panel beyond `--shadow-lg` when it floats over the editor.

## Detail / diff pane (full view)

In the full-width review view, selecting a node fills the right pane; selecting
a range (click v6, ⌘-click v7) renders the diff.

```
┌ v6 → v7 ─────────────────────────────────────────────────────────────────┐
│  ┌───────────────────────────────────────────────────────────────────┐   │
│  │  … unified ⇄ side-by-side diff of extracted text                  │   │
│  │  + added run                                        --status-verified │
│  │  − removed run                                        --status-danger │
│  └───────────────────────────────────────────────────────────────────┘   │
│  content_hash  9f2c…a1  ⧉      prev_hash  4b8e…7d  shield-check links     │  mono/tnum
│  size 41.2 KB (+0.8)  ·  by Alex  ·  "quarter close numbers"             │
│  [ Open v7 ]                    [ Restore v6 ⤴ ]   [ Verify link ] [ ⧉ ]  │
└───────────────────────────────────────────────────────────────────────────┘
```

- The diff operates on **extracted text** from `core` (the same extraction that
  feeds search), so it works across `docx`/`xlsx`/`pdf`/`md`/`txt`/`csv`/`json`/
  `yaml` — a human-readable semantic diff, not a byte diff.
  - Docs: paragraph-level added/removed/changed runs.
  - Sheets: changed cells listed by `Sheet!A1` address, old → new (mono/tnum).
  - Structured text (`json`/`yaml`/`csv`): line/key diff.
- Toggle: unified ⇄ side-by-side. `+`/`−` gutters use `--status-verified` /
  `--status-danger` washes — the two integrity chromas, each with a `+`/`−`
  glyph so meaning survives without color (§9.2).
- **Bytes differ, no extractable text change** note renders when hashes differ
  but extraction is identical (e.g. a re-save that only touched formatting
  metadata) — the byte reality is never hidden behind the human view.
- Diff is a **read**: it decrypts both versions server-side, extracts, and
  diffs. It never writes and never touches the chain. Content = skeleton while
  it computes, never a spinner (ui-system §7.13, principle 7).

## Restore-as-new (additive)

Restore reads as *additive*, in icon and copy (ui-system principle 10, §7.3).

- **Restore v6** (`rotate-ccw`, label "Restore as new version") appends a **new**
  head `N+1` whose bytes equal v6's. v6 and the whole chain are preserved;
  nothing is destroyed.
- Confirm dialog (Radix, `--radius-xl`, ui-system §7.11): title "Restore v6 as a
  new version?"; body "This appends v8, byte-identical to v6. v7 and all prior
  versions are kept." Optional `reason` field (defaults to `Restored from v6`).
  Primary "Restore" (amber, the single primary), secondary "Cancel".
- The new version carries `prev_hash =` the current head's `content_hash`, so the
  chain stays intact and verifiable across the restore.
- Requires an edit-capable role (Editor+; Viewers cannot restore). Emits
  `document.restored` (append-only, chained) with `{ from_seq }`.
- Success toast (sonner, ui-system §7.12): "Version 8 saved · restored from v6",
  with an `rotate-ccw` "Undo" affordance (8s) that itself appends, never erases.
- **Blocked only** by states that forbid new commits (none by default — legal
  hold blocks tombstone/purge, not authoring; retention blocks nothing about
  creating history).

## Verify + provenance (the proof surface)

### Verify chain

- **Verify chain** (panel primary; also per-link "Verify link") runs
  `verify_chain(document_id)`: it re-reads each stored version's ciphertext,
  recomputes `SHA-256(ciphertext)`, and checks each `prev_hash` links to the
  prior `content_hash` end to end.
- It **streams node-by-node** (ui-system §7.3, §7.13): a spinner per node
  resolving to `shield-check` (intact) or `shield-alert` (broken). Under
  `prefers-reduced-motion` this becomes a static determinate count-up, no
  per-node animation (§9.6).
- The result footer summarizes `n verified · m broken`. A verification is itself
  an **audited** event (`provenance.verify`) — see `06-activity-surface.md`.

### Verification badge (ui-system §7.5)

The chain's outcome renders as the two-variant verification badge — icon +
label, never color alone:

```
INTACT:   shield-check  Verified            fg=--status-verified, border-hair,
                                            transparent bg, 20px, --radius-xs

TAMPER:   shield-alert  Tamper detected     fg=--status-danger, bg rgba(163,44,34,0.08),
                                            1px --status-danger border
```

The **block** variant heads the panel when broken (see Integrity). The **inline**
variant sits in the timeline footer and the document row's status cluster.

### Provenance / signature card (ui-system §7.8)

For a **signed / issued** document (Ed25519; DigiLocker-style issuer/registrar;
compliance phase) the head surfaces the provenance card:

```
┌ Provenance ─────────────────────────────────────────────────────────────┐
│  badge-check   Signed                                       shield-check Verified │
│  Issuer      CasualOffice Registry  (Ed25519)                            │
│  Fingerprint 3b9f a204 … c17e            ⧉                              │  mono/tnum
│  Signed at   2026-07-05 14:22:07 UTC                                     │
│  Version     v7 · content_hash 9f2c…a1   ⧉                              │
│  ───────────────────────────────────────────────────────────────────    │
│  [ Verify signature ]           [ Export offline-verifiable bundle ]     │
└──────────────────────────────────────────────────────────────────────────┘
```

- Fields mono where cryptographic (fingerprint, hash), tabular timestamps.
  **Verify signature** runs the Ed25519 check → intact/tamper badge.
- **Unsigned** is neutral, not alarming: `stamp` glyph, `--fg-subtle`, "Not
  signed", with a role-gated "Sign this version" action.

### Export provenance

**Export** (`download`; footer link and provenance card) produces a portable,
offline-verifiable bundle: the ordered `(seq, content_hash, prev_hash, author,
reason, created_at)` chain, the chain head, and — when signed — the Ed25519
signature, so a recipient can **verify offline** that the record is complete and
untampered (`TESTING.md` UC-9). The dialog shows the covered version count and
head hash before download. Formats: JSON (machine) + a human-readable PDF
certificate. A small "Verify a provenance export" entry (here and Admin →
Integrity) checks an imported bundle's internal consistency + signature without
the original hub online.

## Integrity — tamper is an alarm, not a color swap

A broken link or failed signature is a **first-class alarm** (ui-system
principle 9, §7.5, §8.2), never a silent tint:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ shield-alert  Tamper detected  ·  Chain verification failed at v4 → v3.   │
│    The stored bytes no longer match this version's recorded hash.         │
│    Reported to admins. This cannot be dismissed until resolved.           │
│                                        [ View v4 ]  [ Open audit trail ]   │
└──────────────────────────────────────────────────────────────────────────┘
  fg=--fg-default, icon=shield-alert --status-danger, bg rgba(163,44,34,0.08),
  left rule 3px --status-danger, --radius-md, 12px pad, role="alert" aria-live="assertive"
```

- Persists at the **top of the panel**; cannot be dismissed without resolution.
  Names the affected version(s), deep-links Admin → Integrity
  (`11-admin-surface.md`) and the audit entry, and raises a bell entry
  (`10-bell-and-help.md`) a glance can't dismiss.
- **Never auto-repaired** — matches the append-only invariant. The break is the
  record; hiding it would be the real tamper.

## Backend contract

### `GET /api/documents/{id}/versions` (authed, project-member)

```json
{
  "document_id": "doc_01H…",
  "head_seq": 7,
  "chain_verified": true,
  "versions": [
    { "seq": 7, "content_hash": "9f2c…a1", "prev_hash": "4b8e…7d", "size": 42184,
      "author": { "id": "usr_alex", "name": "Alex" }, "reason": "quarter close numbers",
      "created_at": "2026-07-06T12:00:00Z", "held": false, "tombstoned": false },
    { "seq": 4, "content_hash": "…", "prev_hash": "…", "held": true, "tombstoned": false, "…": "…" }
  ],
  "signed": { "issuer": "usr_registrar", "key_fpr": "ED25519:…", "valid": true }
}
```

### Other endpoints

| Method | Path | Effect |
|---|---|---|
| `GET` | `/api/documents/{id}/versions/{seq}/content` | Decrypt-and-stream that version's bytes (diff/open/export). Read-only. |
| `GET` | `/api/documents/{id}/diff?from={a}&to={b}` | Extracted-text diff between two versions. Read-only. |
| `POST` | `/api/documents/{id}/restore` | Body `{ from_seq, reason? }`. Appends `head+1` byte-equal to `from_seq`. Editor+ only. Audited. |
| `POST` | `/api/documents/{id}/verify` | Runs `verify_chain`; returns per-link result. Audited (`provenance.verify`). |
| `GET` | `/api/documents/{id}/provenance/export?format=json\|pdf` | Portable, offline-verifiable chain (+ signature when signed). |

All are project-membership gated; restore additionally requires an edit-capable
role. No endpoint here can update or delete a committed version or audit row.

## States checklist

| State | Required | Notes |
|---|---|---|
| Single version (v1 only) | yes | one node; empty diff reads "One version. History begins here." + stack motif (§7.3) |
| Loading | yes | node + field skeletons matching final geometry (§7.13); no spinner |
| Chain verified | yes | inline `shield-check` "Verified" badge; per-link `shield-check`; footer `n verified` |
| Chain broken (tamper) | yes | block tamper badge + top-of-panel alarm; names failing link; deep-links Admin → Integrity; not auto-cleared |
| Verifying | yes | per-node spinners → check/alert; reduced-motion → static count-up |
| Range selected | yes | diff renders; header `v{a} → v{b}` |
| Restore confirm | yes | dialog states additive semantics + resulting seq |
| Viewer role | yes | timeline, diff, verify, export available; Restore hidden (not just greyed) |
| Held version | yes | `gavel` "hold" chip; tombstone/purge absent from menu |
| Tombstoned (retained) | yes | grouped under `archive` divider, `--fg-subtle`, still listed |
| Signed document | yes | provenance card + valid/invalid signature badge |
| Unsigned | yes | neutral `stamp` "Not signed" + role-gated "Sign this version" |
| Error | yes | inline error state, never a blank timeline |

## Design-system conformance (§1 principles)

1. **Compliance surfaces are load-bearing** (8) — this *is* the flagship; the
   literal chain, verify state, and provenance get first-class component
   treatment with every state designed.
2. **Tamper is an alarm** (9) — persistent, resolution-only, icon + label +
   remediation, `role="alert"` / `aria-live="assertive"`; never a red tint.
3. **Immutable actions read as additive** (10) — restore uses `rotate-ccw` +
   "Restore as new version"; tombstone uses `archive` + "retained".
4. **Amber never alone** (3) — hold `gavel`, verify `shield-check`, tamper
   `shield-alert` each pair icon + label; disabling color loses no information.
5. **Type carries hierarchy** (4) — version label > author/time > hashes; hashes
   render **mono + tabular** (§3.3) for character-by-character comparison.
6. **One primary per surface** (5) — "Verify chain" on the panel; "Restore" /
   "Open in editor" is the detail pane's single context primary.
7. **Sub-100ms** (7) — node selection updates the detail pane instantly; diff
   shows a skeleton, never a spinner.
8. **Keyboard first** (11) — ↑/↓ move selection, `Enter` opens, `D` toggles
   diff mode, `R` restores selected (with confirm), `V` verifies.
9. **One icon family** (14) — Lucide, 1.5px stroke: `git-commit-horizontal`,
   `link`/`unlink`, `shield-check`/`shield-alert`, `badge-check`/`stamp`,
   `gavel`, `archive`, `rotate-ccw`, `copy`.
10. **Reduced motion honored** (13) — verify progress becomes a static count-up;
    entrances fade only; trust surfaces never spring (§5.4).

## Out of scope (later)

- Per-cell / per-paragraph blame — needs per-run authorship on the extraction diff.
- Branching / forking a version into a separate document — the model is a single
  linear chain; a fork is "export + upload as new document".
- Third-party transparency-log anchoring of chain heads — compliance-phase
  extension of the provenance export.
- Cross-document provenance graphs (which documents derive from which).
