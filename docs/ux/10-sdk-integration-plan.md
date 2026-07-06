# 10 — Embedded-editor SDK integration plan (the primary editing path)

**Revised 2026-07-06** — embedded SDK editing is the **primary** path for Doc-Hub. Bytes decrypt server-side and stream into a native editor mounted in the SPA; every save appends a new hash-chained version. **WOPI is demoted to optional interop** for external Office clients — it is not the default and not required for any core flow.

Companion to `07-editor-surface.md` (where the editor mounts), `11-coedit-setup.md` (collab operator guide), and `18-version-history-surface.md` (what a save produces). Source contracts: the sibling editor SDK delivery + iframe-protocol docs in the `sheet` and `document` repos.

## What's inherited (from Casual Drive)

- **WOPI host** — `GET /api/files/{id}/open` mints a per-launch token and hands off to an external editor; the editor calls back to the WOPI endpoints for CheckFileInfo / GetFile / PutFile + Lock. **Kept as optional interop only.** It does not decrypt in the hub's process the way the SDK path does; a PutFile through WOPI still lands as a new hash-chained version via the same commit path. Not the default; not tested as a core flow.
- **`@schnsrw/docx-js-editor`** — `CasualEditor` React component + `FileSource` interface, on npm.
- **`@schnsrw/casual-sheets`** — `CasualSheets` React Univer wrapper, iframe protocol types, on npm. Eager Univer plugin CSS at `@schnsrw/casual-sheets/styles`.
- **Casual PDF** — the `casual_pdf` SDK for annotate/fill/read of `.pdf`.

## What this plan establishes

**Embedded native editing.** The hub `npm install`s the editor SDKs and mounts them directly into its React tree. Opening a `.docx` / `.xlsx` / `.pdf` mounts the real editor — there is no thumbnail, no preview placeholder, no procedural render. Bytes flow through the hub's own content endpoints; **the hub decrypts server-side and streams plaintext bytes over the authenticated app origin into the editor**, and a save re-encrypts and appends a new version.

**Why embedded, not WOPI, as the default:**

- **One container by default.** The hub bundles the editors; no second deploy. Real-time co-edit is opt-in via `DOCHUB_COLLAB_BACKEND_URL=wss://…` (adds the `collab` gateway as a second container) — see `11-coedit-setup.md`.
- **No postMessage hop.** The editor shares the SPA's React state directly; identity propagation and the save→version→audit round trip compose in-process.
- **Same security model as the rest of the hub.** Bytes ride the existing same-origin authenticated session over the app origin. Decryption happens in the hub's memory only; plaintext never reaches a storage backend and never crosses to the user-content origin.
- **The server can index and reason over content.** Because the server holds keys and decrypts to serve the editor, the same plaintext feeds the extraction/index worker. This is the deliberate server-trusted trade (not zero-knowledge E2E); WOPI's external-editor model would fragment it.

### Not in this plan

- **WOPI as a primary path.** It stays wired as optional interop; we don't extend it.
- **Provenance signing UI** — the Ed25519 issuer/registrar flow lives in the compliance surface, not here. This plan produces ordinary authored versions; signed/issued documents are a compliance-phase concern.

---

## Phases (numbered)

### Phase 1 — SDK + `VaultFileSource` (embedded editing → hash-chained versions)

The hub imports `@schnsrw/docx-js-editor`, `@schnsrw/casual-sheets`, and the PDF SDK, mounts them in the editor surface, and routes bytes through content endpoints that decrypt on read and commit a version on write.

1. **P1.1 — Doc-Hub backend.** Two content endpoints (same-origin, session-cookie + CSRF auth, no token mint), both going through `Arc<Storage>` so encryption is mandatory and no handler touches the raw operator:
   - `GET /api/documents/{id}/content` — reads the head version's ciphertext through the storage facade, **decrypts in memory** via `dochub-crypto.open(workspace_dek, …)`, streams the plaintext inline (200, `application/octet-stream`). No plaintext is ever persisted.
   - `PUT /api/documents/{id}/content` — accepts plaintext bytes in the body and runs the **commit path**: `seal(workspace_dek, bytes)` → write-once content-addressed blob via the facade → append a `file_versions` row with `content_hash = SHA-256(ciphertext)`, `prev_hash = ` prior head, incremented `seq`, `author_id`, optional `reason` → emit an append-only, hash-chained `document.version_committed` audit event → enqueue reindex. Returns the new `VersionDto`. The prior version is untouched; nothing is overwritten (CLAUDE.md #6).

   Lives alongside the existing handlers in `crates/dochub-http/src/documents.rs`.

2. **P1.2 — `VaultFileSource`.** Implements the editor's `FileSource` interface against the content endpoints:
   - `open(docId)` → `GET /api/documents/{id}/content` → `{ name, contents: Uint8Array }` (decrypted plaintext).
   - `save(docId, bytes)` → `PUT /api/documents/{id}/content` → returns the committed `VersionDto`.
   - `list / rename / delete / …` → no-op (the hub owns those UIs in its own chrome).

   Lives at `web/src/file-source/VaultFileSource.ts`.

3. **P1.3 — React wrappers.** Thin components wrapping each SDK with `VaultFileSource` + the hub's user identity:
   - `web/src/components/editor/VaultDocEditor.tsx` wraps `<CasualEditor>`.
   - `web/src/components/editor/VaultSheetWorkspace.tsx` wraps `<CasualSheets>`; imports `@schnsrw/casual-sheets/styles` once.
   - `web/src/components/editor/VaultPdfEditor.tsx` wraps the `casual_pdf` viewer/annotator.
   - Markdown (`.md`/`.txt`) mounts the in-house markdown editor; save takes the same commit path.

4. **P1.4 — Editor-surface wiring.** `web/src/components/editor/EditorStage.tsx` routes by document kind:
   - `kind === 'doc'` → `<VaultDocEditor documentId=… />`
   - `kind === 'sheet'` → `<VaultSheetWorkspace documentId=… />`
   - `kind === 'pdf'` → `<VaultPdfEditor documentId=… />`
   - `kind === 'markdown'` → the markdown editor.

   There is no placeholder branch — an unsupported kind (should never occur, given the ingest allowlist) renders a plain "This document type has no editor" panel with a download-current-version action.

5. **P1.5 — Co-edit env flag.** `DOCHUB_COLLAB_BACKEND_URL=wss://collab.hub.example` propagates to the SPA via `/api/about`. When set, the wrappers pass it to the SDKs so edits relay through the `collab` server (Yjs / Hocuspocus), which handles **opaque** document bytes and never parses or decrypts them. When unset, the hub runs as one container (solo editing). Details in `11-coedit-setup.md`.

**Where things live:**

- `crates/dochub-http/src/documents.rs` — `get_content` + `put_content` handlers + routes.
- `crates/dochub-crypto` — already provides `seal`/`open` and the hash-chain append; the handlers call it, they do not re-implement crypto.
- `web/src/file-source/VaultFileSource.ts` — new file.
- `web/src/components/editor/Doc-Hub{Doc,Sheet,Pdf}Editor.tsx` — new files.
- `web/src/components/editor/EditorStage.tsx` — routes by kind.
- `web/package.json` — adds `@schnsrw/docx-js-editor`, `@schnsrw/casual-sheets`, the PDF SDK (peer Univer set).

**Acceptance (maps to `TESTING.md` UC-3):** open a `.docx`/`.xlsx`, edit, save; history shows v2 chained to v1; `content_hash` differs; `verify_chain` passes; a spy storage backend asserts the written bytes are ciphertext (UC "no plaintext at rest").

### Phase 2 — Co-editing across peers (maps to UC-5)

With `DOCHUB_COLLAB_BACKEND_URL` set, two clients edit one document in real time through `collab`; presence + cursors render. On save, **each client's commit lands as an ordered version** — the collab room holds the live Y.Doc; the hub owns the canonical, encrypted, hash-chained bytes. When the last peer leaves, the room drops; the next opener seeds from the hub's decrypted head. The gateway never sees plaintext beyond the opaque Yjs update stream it relays (it does not decrypt at-rest bytes; it relays the collaborative delta between authenticated peers). See `11-coedit-setup.md` for the operator overlay and the production posture (TLS + a dochub-minted JWT gating joins).

**Acceptance:** two browsers co-edit one document; both saves land as ordered versions with a consistent chain (UC-5).

---

## Sequence — Phase 1 (embedded edit → version)

```
Doc-Hub SPA                              Doc-Hub backend
─────────                              ─────────────
user opens a .docx in the editor surface
      │
      ▼
construct VaultFileSource(documentId)
mount <VaultDocEditor documentId=… />
       │ wraps <CasualEditor fileSource={fs} docId=… />
       ▼
fs.open(documentId)
       │
       ▼
GET /api/documents/{id}/content (same-origin cookie + CSRF)
                                     ──► storage.read(head.storage_key)  → ciphertext
                                     ──► dochub-crypto.open(workspace_dek) → plaintext (in memory)
       ◄── 200 application/octet-stream (plaintext, never persisted)
       │
render workbook / document
…
user types / formats  (optionally co-edits via collab)
…
useFileSourceAutoSave → fs.save(documentId, bytes)
       │
       ▼
PUT /api/documents/{id}/content
                                     ──► dochub-crypto.seal(workspace_dek, bytes) → ciphertext
                                     ──► storage.write(new_content_addressed_key, ciphertext)  [write-once]
                                     ──► file_versions.append(content_hash, prev_hash, seq+1, author, reason)
                                     ──► audit.emit_chained("document.version_committed")
                                     ──► index.enqueue(document_id)
                                     ◄── 200 VersionDto
       ◄── 200
version-history strip refreshes; the new version is the chain head
```

Same-origin, same session cookie, no token mint. Decryption is in-process and transient; encryption is mandatory on the write; the prior version is preserved.

---

## What this plan does NOT change

- **The two-origin model.** App origin (`hub.<host>`) serves the SPA, JSON API, and the decrypted editor byte streams; the user-content origin (`usercontent-dochub.<host>`) serves `/raw/{token}` share downloads only. The content endpoints serve from the app origin under the authenticated session; they never move to the user-content origin.
- **Encryption invariants.** No plaintext document bytes reach any storage backend. Boot still refuses to start without a master KEK/KMS.
- **Append-only history.** A save only ever appends; no code path here overwrites or hard-deletes a version, blob, or audit row.
- **WOPI interop.** It coexists as an optional external-client path; a WOPI PutFile funnels through the same version-commit path so external saves are still chained. It is not exercised by the core use-cases.

## Required reading before code lands

1. This doc.
2. `docs/ARCHITECTURE.md` §"Embedded editing" + §"Encrypted storage facade" + §"Immutable version + hash-chain engine".
3. Sibling editor SDK delivery / `FileSource` contract (`sheet`, `document` repos).
4. `18-version-history-surface.md` — the surface a save produces.
5. `crates/dochub-http/src/documents.rs` — current routes.

## Estimated effort (rough)

| Phase | Rust | TS | Tests | Notes |
| ----- | ---- | -- | ----- | ----- |
| 1 | ~140 LOC (content endpoints + commit wiring) | ~320 LOC (VaultFileSource + 3 wrappers) | ~200 LOC | Reuses `dochub-crypto` seal/open + version append |
| 2 | ~40 LOC (collab config + JWT join) | ~120 LOC | ~150 LOC (UC-5 e2e) | Adds the `collab` container |

Pre-code estimates; expect ±30%.

## Why this plan exists

CLAUDE.md's "plan → present → ask → code" means substantive features land plan-first. This is the plan; implementation lands phase-by-phase, each with its own review and its own tests per `docs/TESTING.md`.
