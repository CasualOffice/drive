# 10 — SDK integration plan (Casual Editor / Sheets in-Drive)

Plan-only. No code in this batch. Per CLAUDE.md "plan → present → ask → code"; this doc presents the integration shape so you can sign off before implementation.

Companion to `08-editor-handoff.md` (current WOPI new-tab handoff) and `07-preview-surface.md` (where the iframe-mounted editor would live). Source contracts live in the Casual Editor repo: [`13-iframe-protocol.md`](https://github.com/schnsrw/docx/blob/main/docs/internal/13-iframe-protocol.md) + [`14-sdk-delivery.md`](https://github.com/schnsrw/docx/blob/main/docs/internal/14-sdk-delivery.md).

## What's already shipped

- ✅ **WOPI handoff** (`08-editor-handoff.md`, pipeline row 4.3 + 4.4). `GET /api/files/{id}/open` mints a per-launch token + redirects to the editor in a new tab. The editor calls back to Drive's `/wopi/files/{id}` endpoints for CheckFileInfo / GetFile / PutFile + Lock lifecycle. **This continues to work as the third-party WOPI path** — don't touch it.
- ✅ **`crates/drive-wopi`** — WOPI host implementation (7 endpoints, 409 lock contract, token mint via `mint_token`).

## What this plan proposes

Two new integration shapes, **both opt-in** alongside the existing new-tab WOPI handoff:

### Shape A — Iframe-in-Preview (in-Drive editing)

User clicks an `.xlsx` / `.docx` row → Preview modal opens → editor renders **inside the modal** via iframe instead of being a new-tab dance. Drive's chrome stays visible; the user never loses context.

**Why iframe specifically:**

- Strong security boundary (CSP `frame-ancestors`, cross-origin enforcement).
- Editor deploy stays independent of Drive's deploy cycle.
- WOPI byte transport keeps working under the iframe — only the UX events (selection, save command, lock-lost, signing) get a postMessage layer on top.

Source contract: [iframe protocol](https://github.com/schnsrw/docx/blob/main/docs/internal/13-iframe-protocol.md). The editor's `/embed` route is already shipped; Drive just opens the iframe with the right URL.

### Shape B — SDK + DriveFileSource (npm-embedded editor)

For the future "rich Drive workspace" view that wants tighter integration — drag from Drive's left pane into the editor, share Drive's user state, no postMessage hop. Drive's React SPA imports `@eigenpal/docx-js-editor` (and the sheet equivalent) as an npm dep; the editor is React-mounted directly into Drive's tree.

**Why this matters:** in this mode Drive runs as **one container** when co-edit is off (no second container for the editor's gateway). Operators get a clear cost equation: skip co-edit → simpler deploy; add it → start the Casual gateway as a second container.

This is the bigger lift and lands in a later phase.

---

## Phases (numbered)

### Phase A — Iframe-in-Preview (smallest, ship-first)

1. **A1 — Editor URL shape.** Editor exposes `/embed?app=docs&config=<base64url>`. The base64url JSON is `EmbedConfig { hostOrigin, theme, hideTitleBar?, readOnly? }`. The WOPI bootstrap params (`wopiSrc`, `access_token`) ride along.
2. **A2 — Drive backend.** `GET /api/files/{id}/open` gains a `?mode=iframe` variant that returns the same `editor_app, access_token, access_token_ttl` plus the explicit `entry_url` pointing at `/embed`. WOPI cookies + tokens unchanged.
3. **A3 — Drive SPA Preview Modal.** New `EditorIframe` component renders the iframe + wires the postMessage bridge. Drive code only handles envelopes it cares about; everything else is silently dropped per protocol.
4. **A4 — Bridge events.** Drive listens for:
   - `casual.save.request` → already covered by WOPI PutFile flow (the editor saves to the host's WOPI endpoint directly); used here just for "show a saving spinner in Drive's chrome".
   - `casual.selection.changed` → updates Drive's detail sidebar.
   - `casual.lock.lost` → swaps Drive's chrome into read-only banner.
   - `casual.telemetry.event` → logged into Drive's structured events.
   - Drive sends `casual.command.save` when user clicks Drive's Save shortcut in the preview chrome.

**Where things live:**

- `crates/drive-http` — extends `/api/files/{id}/open` for the iframe mode. ~30 Rust lines.
- `crates/drive-wopi` — unchanged.
- `web/src/components/preview/EditorIframe.tsx` — new ~150 line component.
- `web/src/api/files.ts` — new helper `openInIframe(fileId)` returning the entry URL.

**Out of scope:** signatures (Phase C), SDK embedding (Phase B), tight integration with Drive's left-pane drag-and-drop.

### Phase B — SDK + DriveFileSource

The richer in-Drive workspace. Single-container Drive deploy; Drive imports the editor as an npm component.

1. **B1 — Wait on package shape.** Today `@eigenpal/docx-js-editor` is published; `@sheet/web` is workspace-internal. Phase B requires sheet to also publish — track that separately, don't block on it.
2. **B2 — `DriveFileSource` (TypeScript, ~80 lines).** Implements the editor's `FileSource` interface against Drive's existing file endpoints. Methods: `open`, `save`, plus the trivial `list / rename / delete / watchRecent / rememberLastOpened / lastOpened` that no-op (Drive owns those surfaces in its own UI). Lives at `web/src/file-source/DriveFileSource.ts`.
3. **B3 — Drive backend endpoints.** SDK-mode `open` + `save` hit `GET / PUT /api/files/{id}/content` — thin shims over `crates/drive-storage` that don't need the WOPI 7-endpoint surface. ~50 Rust lines.
4. **B4 — React surface.** `web/src/components/editor/CasualDocEditor.tsx` wraps `<CasualEditor>` from the SDK with a DriveFileSource and the Drive user's identity. Same shape for sheet once it publishes.
5. **B5 — Co-edit toggle.** Operator env `DRIVE_COLLAB_BACKEND_URL=wss://collab.drive.example` flips the editor into collab mode. When unset, Drive runs as one container.

**Where things live:**

- `crates/drive-http` — new content endpoints alongside existing WOPI surface. ~50 Rust lines.
- `web/src/file-source/DriveFileSource.ts` — new file. ~80 TS lines.
- `web/src/components/editor/CasualDocEditor.tsx` — new file. ~150 TS lines.
- `web/package.json` — adds `@eigenpal/docx-js-editor` (sheet later).

**Out of scope:** signature pipeline (Phase C).

### Phase C — Signature pipeline

Drive becomes a real signing workflow host: user clicks "Sign this file" → Drive opens the editor in signing mode → user signs anchored fields → Drive's Rust backend stamps the signatures + writes an audit row.

1. **C1 — Audit table.** Migration adds `signature_sessions` + `signature_fields` rows. Schema:

   ```sql
   CREATE TABLE signature_sessions (
     id          TEXT PRIMARY KEY,           -- ULID
     file_id     TEXT NOT NULL REFERENCES files(id),
     started_by  TEXT NOT NULL,              -- user id
     started_at  INTEGER NOT NULL,           -- unix seconds
     mode        TEXT NOT NULL,              -- 'sequential' | 'concurrent'
     completed_at INTEGER,                   -- null until session done
     cancelled_at INTEGER,
     cancel_reason TEXT
   );
   CREATE TABLE signature_fields (
     id            TEXT PRIMARY KEY,         -- ULID
     session_id    TEXT NOT NULL REFERENCES signature_sessions(id),
     field_id      TEXT NOT NULL,            -- client-side field id
     label         TEXT NOT NULL,
     required      INTEGER NOT NULL,         -- 0/1
     anchor_kind   TEXT NOT NULL,            -- 'doc' | 'sheet'
     anchor_para_id TEXT,                    -- for docs
     anchor_sheet  TEXT,                     -- for sheets
     anchor_cell   TEXT,                     -- for sheets
     method        TEXT,                     -- null until signed
     signature_bytes_path TEXT,              -- blob storage path
     signed_at     INTEGER,
     signer_user_id TEXT
   );
   ```

   Portable across SQLite + Postgres per CLAUDE.md hard rule.

2. **C2 — Backend endpoints.**
   - `POST /api/files/{id}/sign` — opens a signing session. Body: the `SignatureField[]` array + mode. Response: `{session_id, signing_url}` where `signing_url` is the editor's `/embed?app=docs&signing=<base64-session-id>&...`.
   - `POST /api/sign-sessions/{session_id}/fields` — editor posts per-field bytes via the postMessage bridge → Drive's SPA forwards to this endpoint → Rust persists the bytes to `crates/drive-storage` + writes the audit row.
   - `POST /api/sign-sessions/{session_id}/complete` — fires when all required fields are done; Drive's Rust side stamps the bytes into the workbook/doc using `ring` (or `umya-spreadsheet` for sheet) + writes the final etag back via the existing WOPI PutFile path.
   - `POST /api/sign-sessions/{session_id}/cancel` — fires on `casual.signature.cancel`. Writes the cancel reason + leaves the file untouched.

3. **C3 — Drive SPA.** "Sign this file" action in the Preview modal opens the editor iframe with `signing` config. The postMessage bridge listens for `casual.signature.field.signed` / `casual.signature.complete` / `casual.signature.cancel` and forwards to the corresponding `/api/sign-sessions/...` endpoint.

4. **C4 — Identity attestation.** The session's `signer_user_id` comes from Drive's authenticated session (`__Host-cd_sid`). The editor doesn't choose who the signer is; Drive does. The editor receives the signer's name + email in the `SignatureField.signer` field purely as a UX hint (rendered next to "Type your name").

**Where things live:**

- `crates/drive-db/migrations/` — new migration. SQLite + Postgres compatible.
- `crates/drive-http/src/handlers/signing.rs` — new file. ~250 Rust lines.
- `crates/drive-storage` — extends with a `put_signature_blob(session_id, field_id, bytes) → path` method.
- `crates/drive-signing/` — **new crate**. Owns the stamping logic + the `ring` dep so the rest of Drive stays crypto-free. ~300 Rust lines.
- `web/src/components/preview/EditorIframe.tsx` — extended with the signature postMessage handlers.
- `web/src/components/signing/SigningButton.tsx` — new "Sign this file" affordance. ~100 TS lines.

**Out of scope:**

- **PKI-grade signing (X.509 detached signatures).** Drive's v0 signing pipeline produces drawn / typed / uploaded images stamped into the bytes. CA-issued signatures are a v0.2 extension on the existing `signature_bytes_path` blob — the protocol carries opaque bytes; the crypto choice is the host's.
- **Multi-party sequential delegation across signers** ("Alice signs → email Bob → Bob signs"). The protocol supports `sequential` mode within a single session; cross-session orchestration is a Drive feature, not editor protocol.
- **Field placement UI inside Drive.** Phase C ships with operator-supplied field arrays only. Drive's "click to place a signature here" UI is Phase D.

---

## Sequence — Phase A (iframe-in-Preview)

```
Drive SPA              Drive backend                Editor (iframe)
─────────              ─────────────                ───────────────
user clicks .docx row
      │
      ▼
GET /api/files/{id}/open?mode=iframe
      │             ──► mint WOPI token
      │                 build /embed?wopiSrc=...&access_token=...
      │             ◄── 200 {entry_url, access_token_ttl}
      │
mount <EditorIframe src={entry_url}>
                                                    boot SPA, parse EmbedConfig
                                                    ◄────── casual.hello
casual.hello (capabilities, authToken) ─────────►
                                                    ◄────── casual.ready
                                                    ◄────── casual.load.request via WOPI (NOT iframe)
                                                          (editor reaches Drive's
                                                           /wopi/files/{id}/contents)
                          ◄── WOPI byte fetch       render document
                                                    ◄────── casual.selection.changed × N
Drive sidebar updates from selection events
                                                    ◄────── casual.lock.lost (if applicable)
Drive chrome flips to read-only banner
…
user clicks Drive's chrome "Save"
casual.command.save ────────────────────────────►
                                                    triggers WOPI PutFile
                          ◄── byte save             ◄────── casual.telemetry.event (save)
Drive's "Last modified" updates
```

The two transports compose: **WOPI for bytes, postMessage for UX events.** Neither replaces the other.

---

## Open questions for sign-off

Tag with my best-guess default; flip in your review.

1. **Phase A vs Phase B priority?** Default: A first (smaller, ships iframe-in-Preview UX without bundling the editor; B follows when sheet publishes).
2. **Signature blob storage backend?** Default: `crates/drive-storage`'s existing OpenDAL facade (fs / s3 / memory / minio — same four backends as file bytes). Alternative: a dedicated signatures bucket with stricter ACLs.
3. **Audit row partitioning?** Default: one row per session + one per field. Alternative: collapse into one row per signed field with the session metadata denormalised.
4. **Co-edit operator default in Phase B?** Default: off (one container). Operators flip `DRIVE_COLLAB_BACKEND_URL` to enable.
5. **Signing crate naming?** Default: `crates/drive-signing`. Keeps the crypto dep (`ring`) isolated from the rest of Drive.
6. **Field anchor UI?** Default: operator-supplied field arrays via API (no in-Drive placement UI in Phase C). Drive admins POST `/api/files/{id}/sign` with the field list; the field-placement UI is Phase D.

---

## What this plan does NOT change

- The existing WOPI new-tab handoff (`08-editor-handoff.md`). Both paths coexist.
- The two-origin model (`drive.<host>` for app, `usercontent-drive.<host>` for raw bytes). The iframe lives in the app origin; the editor's bytes come through WOPI as today.
- The single-tenant admin auth model. SDK + iframe paths use the existing `__Host-cd_sid` session.
- The "no multi-user accounts in v0" rule. Phase C signatures are signed by the authenticated admin; multi-user signing is a v0.2+ feature.

## Required reading before code lands

1. This doc.
2. [Casual Editor iframe protocol](https://github.com/schnsrw/docx/blob/main/docs/internal/13-iframe-protocol.md).
3. [Casual Editor SDK delivery](https://github.com/schnsrw/docx/blob/main/docs/internal/14-sdk-delivery.md).
4. [Casual Sheets signing + embed](https://github.com/schnsrw/sheets/blob/main/docs/SDK_SIGNING_EMBED.md).
5. `08-editor-handoff.md` (existing WOPI path).
6. `crates/drive-wopi/src/handlers.rs` — current handoff implementation.

## Estimated effort (rough)

| Phase | Rust | TS | Tests | Notes |
| ----- | ---- | -- | ----- | ----- |
| A | ~30 LOC | ~150 LOC | ~80 LOC | Smallest, shippable independently |
| B | ~50 LOC | ~230 LOC | ~150 LOC | Blocked on sheet publishing |
| C | ~550 LOC (new crate) | ~250 LOC | ~250 LOC | Largest; new crate + migrations |

Numbers are pre-code estimates; expect ±30%.

---

## Why this plan exists

Drive's "plan → present → ask → code" rule (CLAUDE.md §"Default working mode") means substantive features land plan-first. This is the plan; the implementation lands in subsequent PRs phase-by-phase, each with its own narrower review.
