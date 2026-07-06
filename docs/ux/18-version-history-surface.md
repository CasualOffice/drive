# 18 — Version history surface

Companion to `02-surface.md`, `10-sdk-integration-plan.md` (what a save produces), `11-admin-surface.md` (retention / legal hold / integrity), and `docs/ARCHITECTURE.md` §"Immutable version + hash-chain engine". This is Doc-Hub's defining surface: the timeline of a document's immutable, hash-chained versions, with diff, restore-as-new, and provenance verification. Everything a registry promises — a history you can prove and can't rewrite — is made legible here.

## What it renders

For a document, the append-only chain from `file_versions`:

```
file_versions(file_id, seq, storage_key, size, content_hash, prev_hash, author_id, reason, created_at)
```

Each version row is one entry on the timeline: sequence, author, timestamp, size delta, an optional `reason`, and the `content_hash`/`prev_hash` link. The head (highest `seq`) is the current document. Nothing here is ever mutated or removed — restore and tombstone are additive.

## Opening it

- The kebab / context menu on a document → "Version history"; keyboard `H` on the focused document.
- Inside the editor, a "History" affordance in the chrome opens the same surface as a right-hand panel over the editor.
- Route: `/document/{id}/history` (shareable within the project; membership-gated).

## Layout

```
┌─ Version history — Q3 roadmap.docx ─────────────────────────────────────┐
│  Chain ● verified through v7 · 7 versions                    [ Verify ] │
│                                                                          │
│  ┌─ Timeline (left, scrolls) ──────┐┌─ Detail / diff (right) ─────────┐ │
│  │  ● v7  head   Alex   2h ago     ││  v6 → v7                        │ │
│  │       "quarter close numbers"   ││  ┌───────────────────────────┐  │ │
│  │  ○ v6         Sam    yesterday  ││  │ … unified / side-by-side  │  │ │
│  │  ○ v5         Alex   Jul 2      ││  │   diff of extracted text  │  │ │
│  │  ○ v4  🔒 hold Alex  Jun 30     ││  │   +added   −removed       │  │ │
│  │  ○ v3         Sam    Jun 28     ││  └───────────────────────────┘  │ │
│  │  ○ v2         Alex   Jun 27     ││  content_hash  9f2c…a1          │ │
│  │  ○ v1  origin Alex   Jun 25     ││  prev_hash     4b8e…7d ✓ links  │ │
│  │                                 ││  size 41.2 KB (+0.8)  by Alex   │ │
│  │  ── Tombstoned (retained) ──    ││  [ Open v7 ] [ Restore v6 ]     │ │
│  └─────────────────────────────────┘│  [ Verify this link ] [ Export ]│ │
│                                      └─────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Left timeline** — one node per version, newest first, head badged. Each node shows author avatar, relative time (absolute on hover), and the truncated `reason`. Selecting two nodes (click v6, ⌘-click v7) sets the diff range.
- **Right detail** — for a single selection: the version's hashes, size, author, reason, and per-link verification state. For a range: the diff.
- **Chain status banner** — `● verified` in `--success` when the recomputed chain matches end to end; `● verification failed at v4` in `--danger` when a link is broken (see "Integrity" below). Never auto-repairs.
- **Legal-hold / retention markers** — a `🔒 hold` chip on any version under an active legal hold; a muted "Tombstoned (retained)" section groups versions past a tombstone marker whose bytes are retained under hold/retention. Tombstoned entries are shown, greyed, never hidden — the history is complete or it isn't a registry.

## Diff

- The diff operates on **extracted text** from `core` (the same extraction that feeds search), so it works across `docx`/`xlsx`/`pdf`/`md`/`txt`/`csv`/`json`/`yaml` — a human-readable semantic diff, not a byte diff.
  - Docs: paragraph-level added/removed/changed runs.
  - Sheets: changed cells listed by `Sheet!A1` address, old → new.
  - Structured text (`json`/`yaml`/`csv`): line/key diff.
- Toggle: unified ⇄ side-by-side. `+`/`−` gutters use `--success`/`--danger` token backgrounds.
- Binary reality: the underlying bytes differ per `content_hash`; the text diff is the human view. A "bytes differ, no extractable text change" note renders when hashes differ but extraction is identical (e.g. a re-save with only formatting metadata).
- Diff is a **read** — it decrypts both versions server-side, extracts, and diffs; it never writes and never mutates the chain.

## Restore-as-new

- **Restore v6** appends a **new** head version `N+1` whose bytes equal v6's bytes (`ARCHITECTURE.md`: restore is additive). v6 and the whole chain are preserved; nothing is destroyed.
- Confirm dialog: "Restore v6 as a new version? This adds v8 identical to v6. v7 and all prior versions are kept." Optional `reason` field (defaults to `Restored from v6`).
- The new version carries `prev_hash = ` the current head's `content_hash`, so the chain stays intact and verifiable across the restore.
- Requires an edit-capable role (Editor+; Viewers cannot restore). Emits `document.restored` (append-only, chained) with `{ from_seq }` metadata.
- **Blocked** if the document is under a state that forbids new commits (none by default — legal hold blocks *tombstone/purge*, not authoring; retention blocks nothing about creating history).

## Provenance + verify

The registry's proof surface:

- **Verify** (banner button, and per-link "Verify this link") runs `verify_chain(document_id)`: it re-reads each stored version's ciphertext, recomputes `SHA-256(ciphertext)`, and checks each `prev_hash` links to the prior `content_hash` end to end. Result is rendered inline and **audited** — a verification is itself an event. A break is surfaced, never silently fixed, and raises the admin integrity alarm (`11-admin-surface.md`) plus a bell entry (`10-bell-and-help.md`) that a glance can't dismiss.
- **Provenance chip** — for a **signed/issued** document (Ed25519, DigiLocker-style issuer/registrar; compliance phase), the head shows an issuer badge and "Signature valid · issued by <registrar> on <date>". Clicking it shows the signing key fingerprint and the signed payload (the version's `content_hash`).
- **Export provenance** → downloads a portable bundle: the ordered `(seq, content_hash, prev_hash, author, reason, created_at)` chain, the chain head, and — when signed — the Ed25519 signature, so a recipient can **verify offline** that the record is complete and untampered (`TESTING.md` UC-9). The dialog shows the covered version count and head hash before download. Formats: JSON (machine) + a human-readable PDF certificate.
- **Verify an imported bundle** — a small "Verify a provenance export" entry (in Admin → Integrity and on this surface) accepts a previously exported bundle and confirms its internal consistency + signature without needing the original hub online.

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
| `GET` | `/api/documents/{id}/versions/{seq}/content` | Decrypt-and-stream that version's bytes (for diff/open/export). Read-only. |
| `GET` | `/api/documents/{id}/diff?from={a}&to={b}` | Extracted-text diff between two versions. Read-only. |
| `POST` | `/api/documents/{id}/restore` | Body `{ from_seq, reason? }`. Appends `head+1` byte-equal to `from_seq`. Editor+ only. Audited. |
| `POST` | `/api/documents/{id}/verify` | Runs `verify_chain`; returns per-link result. Audited. |
| `GET` | `/api/documents/{id}/provenance/export?format=json\|pdf` | Portable, offline-verifiable chain (+ signature when signed). |

All are project-membership gated; restore additionally requires an edit-capable role. No endpoint here can update or delete a committed version or audit row.

## States checklist

| State | Required | Notes |
|---|---|---|
| Single version (v1 only) | yes | timeline shows one node; diff panel shows "First version — nothing to compare" |
| Loading | yes | timeline + detail skeletons matching final geometry |
| Chain verified | yes | green banner; per-link ✓ |
| Chain broken | yes | red banner naming the failing link; deep-links Admin → Integrity; alarm not auto-cleared |
| Range selected | yes | diff renders; header shows `v{a} → v{b}` |
| Restore confirm | yes | dialog states additive semantics + resulting seq |
| Viewer role | yes | timeline, diff, verify, export all available; Restore hidden/disabled with a tooltip |
| Held version | yes | `🔒 hold` chip; tombstone/purge actions absent |
| Tombstoned (retained) | yes | grouped, greyed, still listed; bytes present under hold/retention |
| Signed document | yes | provenance chip + valid/invalid signature state |
| Verify in progress | yes | banner shows "Verifying…" with a determinate count as links are checked |
| Error | yes | inline ErrorState; never a blank timeline |

## Polish bar (relevant commandments)

1. **One primary action** — the detail panel's primary is context-dependent: "Restore" for a past version, "Open in editor" for the head.
2. **Type carries hierarchy** — version label > author/time > hashes (monospace, `--muted`).
3. **Concentric corners** — timeline nodes and diff card share the container rounding.
5. **Sub-100 ms** — selecting a version updates the detail panel instantly; the diff (which decrypts + extracts server-side) shows a skeleton, never a spinner.
7. **Keyboard first** — ↑/↓ move the timeline selection, `Enter` opens, `D` toggles diff mode, `R` restores the selected version (with confirm).
9. **One icon family** — Lucide; the hash-link ✓/✗ and the `🔒` hold marker are Lucide `Check`/`X`/`Lock`.

## Out of scope (later)

- Per-cell / per-paragraph blame ("who last changed this line") — needs per-run authorship, a follow-up on the extraction diff.
- Branching / forking a version into a separate document — the model is a single linear chain; a fork is "export + upload as new document".
- Third-party transparency-log anchoring of chain heads — compliance-phase extension of the provenance export.
- Cross-document provenance graphs (which documents cite/derive from which).
