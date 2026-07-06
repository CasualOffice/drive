# 08 — Editor handoff (embedded native editors; WOPI optional interop)

Companion to `docs/ARCHITECTURE.md` §"Embedded editing" + §"Token model". Defines how a document opens for editing. In Doc-Hub the **primary path is an embedded native editor inside the SPA** — Casual Sheet, Casual Docs, Casual PDF, and the Markdown/text editor. **WOPI is demoted to optional interop** for external Office clients; it is never the default.

## Why embedded is primary

- Bytes are **encrypted at rest**. To edit, the server decrypts the current version **in memory** and streams it to the embedded editor over the authenticated **app origin** — no plaintext ever hits disk, no new browser origin, no launcher tab.
- Saving must **append a hash-chained version + an audit event**. An in-SPA editor lets Doc-Hub own that commit path directly instead of reconstructing it from a WOPI `PutFile` callback.
- **Co-editing** runs through the `collab` server (Yjs/Hocuspocus), which relays opaque document bytes. Embedding keeps presence, autosave, and version commits coherent.

WOPI stays available so an operator who wants desktop-Office / Collabora interop can wire it, but it is a config-gated side path.

## Embedded flow (primary)

```
SPA (hub.<host>)                     Doc-Hub backend                        collab server (optional)
──────────────────                     ─────────────                        ────────────────────────
open "Budget Q2.xlsx"
      │
      ▼
GET /api/files/{id}/editor ─────────►  verify access (member/role)
                                       mint editor access token
                                       pick embedded editor by type
                                       decrypt current version in memory
                              ◄──────  200 {editor, version, access_token,
                                            access_token_ttl, stream_url, collab_url?}
mount <Editor> in the SPA
GET stream_url (app origin) ────────►  stream decrypted bytes (TLS, in-memory)
      │
      ├─ (team doc) connect collab_url ───────────────────────────────────►  presence + CRDT relay
      ▼
user edits (autosave or Cmd-S)
POST /api/files/{id}/versions ──────►  encrypt bytes → write write-once blob
                                       append version {content_hash, prev_hash, seq}
                                       append audit files.edit
                                       enqueue reindex
                              ◄──────  201 {version: N+1, content_hash}
editor chrome advances vN → vN+1
```

The **editor access token** is per-launch, per-document, short-TTL, HMAC-signed over `(user_id, file_id, perms, exp, jti)`; the document id in the stream/save URL must match the claim (`verify_token`). It is a distinct token from share-link and signed-URL tokens — never interchangeable.

### `GET /api/files/{id}/editor` (authed)

```json
{
  "editor": "sheet",                         // "sheet" | "docs" | "pdf" | "markdown"
  "version": 4,                              // the head being opened
  "access_token": "<hmac-jwt>",
  "access_token_ttl": 600000,                // ms; short TTL, refreshed transparently
  "stream_url": "https://hub.<host>/api/files/f_xyz/stream?v=4",
  "collab_url": "wss://hub.<host>/collab/f_xyz"   // present only for co-editable team docs
}
```

- **401** no session · **403** caller can't edit this document (role/perms) · **404** missing or tombstoned · **415** the type has no embedded editor (opaque `.xlsm`/`.pptx`) → the SPA offers **Download** instead.

Embedded-editor dispatch:

| Extension | Sniffed content_type | `editor` | Editor |
|---|---|---|---|
| `.xlsx`, `.csv` | spreadsheet MIME | `sheet` | Casual Sheet (embedded) |
| `.docx` | wordprocessing MIME | `docs` | Casual Docs (embedded) |
| `.pdf` | `application/pdf` | `pdf` | Casual PDF (embedded) |
| `.md`, `.txt`, `.json`, `.yaml` | text MIMEs | `markdown` | Markdown/text editor (embedded) |
| `.xlsm`, `.pptx` (opaque) | — | (415) | Download only |

### `POST /api/files/{id}/versions` (authed, editor-token gated)

Body is the edited document bytes (opaque). The server encrypts, writes write-once, and appends `version N+1` with `content_hash = SHA-256(ciphertext)` and `prev_hash =` the previous head's hash. Response `201 {version, content_hash}`. Nothing is overwritten; the previous version stays in the chain. Concurrent co-edit saves are serialised by the collab session so the chain stays linear (see flow 8 in `01-flows.md`).

## SPA behaviour (embedded)

1. From the document detail modal's primary action (or the row's **Open**), call `openInEditor(file.id)` → `GET /api/files/{id}/editor`.
2. Mount the matching `<Editor>` component in place (no new tab). Show the version (`vN`) in the editor chrome and a **Read-only** badge if perms are view-only.
3. Fetch `stream_url` with `credentials: "same-origin"`; the editor renders the decrypted bytes.
4. On autosave / `Cmd-S`, POST the bytes to `/versions`; on 201 advance the chrome to `vN+1` and (optionally) toast **"Saved as vN+1."**
5. For team documents, connect `collab_url` for presence + live merge; fall back to single-writer with a banner if the collab server is unreachable.
6. Audit-emit `files.open_in_editor` and `files.edit` server-side so the Activity feed renders "opened / saved *Q2.xlsx*".

## WOPI (optional interop)

WOPI is off by default and only lights up when a WOPI target is configured. It exists for external Office / Collabora clients, not for the in-app experience.

- Config (all optional):
  ```
  DOCHUB_WOPI_ENABLED       = false            # default off
  DOCHUB_SHEET_ORIGIN       = https://sheet.<host>
  DOCHUB_DOCS_ORIGIN        = https://docs.<host>
  ```
- When enabled, the document detail dropdown shows **"Open in external app (WOPI)"** as a secondary action. Doc-Hub mints a WOPI access token `(user_id, file_id, perms, exp, jti)` (10-min TTL, refreshed via `CheckFileInfo`) and the external editor calls back to `/wopi/files/{id}` and `/wopi/files/{id}/contents` **on the app origin** (also covered by `host_dispatch`). A WOPI `PutFile` lands through the same version-commit path — it appends a hash-chained version, exactly like the embedded save.
- When `DOCHUB_WOPI_ENABLED=false` (default), `/wopi/*` returns 404 and the external-app action is hidden. Embedded editing is unaffected.

## Demo mode

The Pages demo has no live editor sibling, so `openInEditor` returns synthesised metadata and the SPA shows a read-only rendered preview plus: *"Casual Sheet / Docs isn't included in the static demo — self-host the real build to edit."* + a Download fallback. The buttons stay discoverable instead of silently failing.

## Security recap

- The editor access token is bound to user, file id, perms, and a `jti`, validated on every stream/save call; the URL `file_id` must match the claim.
- Editing is **app-origin only** (session cookies live there); the collab socket and byte stream never move to the user-content origin.
- Decryption is in-memory and streamed; no decrypted document bytes are ever written to a storage backend (property-tested with a spy backend).
- The mint is gated by project role today. Share-link recipients with future edit permission (v0.2) get their own per-share scoped token at `/s/{token}/editor`.
- Every version commit — embedded or WOPI — goes through the single append-only, hash-chained path. There is no code route that overwrites a version.

## Out of scope (v0)

- Edit handoff from share-link recipients — needs recipient-scoped session + RBAC. v0.2.
- Casual Slides for `.pptx` — the sibling editor doesn't exist yet; the slot returns 501 until it ships.
- Cross-editor co-editing presence surfaced at the Doc-Hub list level — the editor owns its own collaboration; Doc-Hub owns documents and versions.
