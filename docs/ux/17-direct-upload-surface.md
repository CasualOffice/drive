# 17 — Upload surface + the direct-path decision

Companion to `docs/research/10-direct-upload.md` and `docs/ARCHITECTURE.md` §"Encrypted storage facade". The SPA's user-visible upload behaviour, the documents-only ingest gate, and why the presigned direct-to-bucket path is **not** used for document bytes in the hub.

## The decision: no plaintext ever reaches a backend

Doc-Hub's core invariant is that **no plaintext document bytes are written to any storage backend** — every byte is sealed by `dochub-crypto` under the project DEK *inside the hub process* before it reaches storage (CLAUDE.md hard rule; `TESTING.md` invariant 1, asserted by a spy backend). The hub holds the keys; the client never does (this is deliberately not zero-knowledge E2E).

A classic "direct upload" (the SPA presigns a URL and `PUT`s bytes straight to the bucket) is **incompatible** with that invariant: the client has no DEK, so anything it writes directly would be plaintext at rest — including any transient staging object, which the spy-backend test would catch. So the presigned direct-to-storage optimization is **retired for document bytes**. The single authoritative ingest path is the **sealing proxy**: bytes stream through the hub, which sniffs, allowlist-checks, seals, and writes ciphertext. Large uploads are handled by streaming + multipart *through* the hub, not by bypassing it.

This is the honest trade: we give up the direct-to-bucket network shortcut to keep the encryption guarantee absolute. BYO buckets are still fully supported — the ciphertext lands in the operator's own bucket; only the plaintext-bypass is gone.

## What the user sees

The upload card, drag-drop ghost rows, progress chip, and toast messages are unchanged from a normal upload. Two dochub-specific behaviours are visible:

1. **Rejected type** → the disallowed document is refused *before* any bytes are stored, with a clear toast: `"Doc-Hub stores documents only. '<name>' (video/mp4) was not uploaded."` The allowlist is `docx, xlsx, xlsm, pptx, pdf, md, txt, csv, json, yaml`. There is no quarantine — a rejected file is never written anywhere.
2. **Quota refused** (413 from `/api/documents`) → toast: "Out of space. Need more? Settings → Storage."

## Ingest gate (every upload path)

Enforced server-side on the sealing proxy, by **extension and magic-byte sniff** (`TESTING.md` invariant 8):

1. Extension must be in the allowlist.
2. `core`/`infer` sniffs the leading bytes; the sniffed type must match an allowlisted document type. A `.docx` that sniffs as a ZIP with the OOXML signature passes; a `.docx` that sniffs as `video/mp4` is rejected. Opaque `xlsm` is accepted as a document but its macros are never executed or indexed.
3. On pass: `seal(project_dek, bytes)` → write-once content-addressed blob → first `file_versions` row (`seq = 1`, `prev_hash = null`, `content_hash = SHA-256(ciphertext)`) → append `document.created` audit event → enqueue reindex.

Reject, don't quarantine. A rejected upload leaves no row and no bytes.

## Internal flow (developer-visible)

```
SPA                              Doc-Hub (sealing proxy)          Backend (ciphertext only)
 │                                 │                              │
 │── POST /api/documents ─────────▶│                              │
 │   multipart: name, project_id,  │                              │
 │   parent_id, stream of bytes    │                              │
 │                                 │─ sniff + allowlist check ────│
 │                                 │   reject → 415, no write     │
 │                                 │─ seal(project_dek, bytes) ───│
 │                                 │── write(content_key, ct) ───▶│  (ciphertext)
 │                                 │─ append file_versions(seq=1) │
 │                                 │─ audit.emit("document.created")
 │                                 │─ index.enqueue(document_id)  │
 │   201 ◀── DocumentDto           │                              │
```

Failure modes:

- **Disallowed type (415).** Rejected pre-write; toast as above. No row, no bytes.
- **Quota exceeded (413).** The quota check sees the declared size and refuses before streaming to storage. Existing quota toast.
- **Stream aborted mid-upload (tab closed / network drop).** No partial version is committed — the version row is written only after the full sealed blob lands, so an interrupted upload leaves nothing to reconcile (no orphaned `uploading` rows). The client may retry cleanly.
- **Seal failure / backend unreachable.** 500 with a sanitized message; nothing is committed. Keys never appear in the error.

## States checklist

- **Selecting project mid-upload:** the upload targets the `project_id` captured at request start; switching projects in the UI doesn't move an in-flight upload. It lands in the original project.
- **Large document:** streamed and sealed in chunks through the hub; multipart to the backend is an internal detail invisible to the user. No plaintext chunk is ever written to the backend.
- **Parallel uploads exhausting quota:** the second request's quota check refuses with 413; the existing toast shows.

## Out of scope

- Client-side (browser) encryption / a true E2E upload path — explicitly out of scope; the server holds keys by design so it can index and reason over content.
- Presigned direct-to-bucket uploads — retired (see the decision above); would violate no-plaintext-at-rest.
- Upload progress % streamed from the backend seal step — v0 reports client-side send progress only.
- "Resume failed upload" UI.
