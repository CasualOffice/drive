# 10 — Direct-to-storage upload

Pipeline §13.6. Lets the client `PUT` an **already-encrypted** document straight at the configured storage backend (S3, MinIO, R2, B2) without proxying the bytes through the Doc-Hub process. For everything else (filesystem, in-memory, or workspaces with no native-presign capability) the existing multipart proxy stays the path.

The hard constraint that shapes this whole design: **no plaintext document bytes may ever land in a backend** (`CLAUDE.md`), and **every ingest path enforces the documents-only allowlist by extension and magic-byte sniff** (Testing invariant #8). A naive presigned PUT would violate both — the client would push raw plaintext the server never inspects. So the direct path here is *encrypt-then-PUT* plus a *post-finalize decrypt-and-sniff*, reconciled below.

## Why

- **Offload CPU + egress from the host.** Proxying a large PDF or spreadsheet through `axum::Multipart` *and* sealing it in-process ties up a Doc-Hub worker for the whole transfer. Direct PUT lets the client and the bucket talk over the client's own bandwidth; the client does the AES-256-GCM sealing. Operators on a $5 VPS care.
- **Failure isolation.** A truncated multipart used to dirty the request body; a failed direct PUT just leaves a half-uploaded object we clean up on `abort` or never finalize (and never chain into a version).
- Still bounded to documents. This is not a media-upload fast path — the allowlist (`docx, xlsx, xlsm, pptx, pdf, md, txt, csv, json, yaml`) applies exactly as on the proxy path.

Out of scope: multipart (chunked) upload protocol — the bucket's native multipart isn't exposed in v0. Single-PUT object size is bounded by the provider (5 GB on S3 without chunking); hub documents sit far below that. Resumable is `⏸ v0.2+` per pipeline §6.7.

## Reconciling direct upload with no-plaintext-at-rest + sniffing

The hub is **server-trusted, not zero-knowledge** — the server holds the workspace DEK. That is exactly what makes the direct path safe:

1. **Encrypt-then-PUT (primary).** At presign, the server hands the client a short-lived **content key** — a random per-upload key wrapped under the workspace DEK — alongside the presigned PUT URL. The client seals the document client-side with AES-256-GCM and PUTs the ciphertext (`nonce ‖ ciphertext ‖ tag`). Only ciphertext ever touches the bucket. Because the server can unwrap the content key (it holds the DEK), the bytes are fully recoverable server-side — this is not E2E, and it must not be.
2. **Decrypt-and-sniff at finalize (mandatory, not deferred).** On `complete`, the server reads the first ~4 KiB of the object via the storage adapter, decrypts it with the unwrapped content key, and runs the magic-byte sniff (`infer`) + extension allowlist. If the sniffed type isn't in the allowlist, the object is deleted and the row rejected. This replaces the old plan's "trust the client-asserted MIME" — the server *does* see the bytes, just after they land, and rejects before the row becomes a committed version.
3. **Gateway encryption (alternative).** Where a trusted encrypting gateway fronts the bucket, the client PUTs plaintext over TLS to the gateway, which sniffs, seals with the workspace DEK, and writes ciphertext. This keeps the sniff pre-write but reintroduces a hop; it's the fallback for clients that can't run WebCrypto. Primary is client-side encrypt-then-PUT.

Net: the bucket only ever holds ciphertext, and no document becomes a version until the server has decrypted its head and confirmed it's an allowed document type.

## When the direct path activates

Only when **all** are true:

1. The workspace's effective storage adapter is one of `s3`, `minio`, `r2`, `b2` (native `presign_write`). `fs` and `memory` always use the proxy.
2. The client can seal client-side (WebCrypto `AES-GCM` available) — otherwise fall back to proxy (or gateway) so no plaintext is PUT.
3. The document is **≥ 8 MiB** at the SPA boundary (smaller documents don't benefit; the proxy round-trip is cheaper than the extra metadata + key-grant roundtrip). Large scanned PDFs and big spreadsheets are the realistic case.
4. The client opts in via a feature flag (`VITE_DIRECT_UPLOAD=1`) for the first release; flips on by default after a beta window.

Below those thresholds the SPA uses the existing `POST /api/files` multipart path, which seals in-process.

## Document lifecycle (with status)

A committed document is a hash-chained version. Direct upload introduces a pending state for the window between presign and finalize, before the first version is chained:

```
                          ┌─ proxy upload (single multipart) ──────────────┐
                          │   POST /api/files                              │
                          │      → seal in-process → write-once blob       │
                          │      → append version v1 (content_hash)        │
                          │      → row status='ready'                      │
                          └────────────────────────────────────────────────┘

   ┌─ direct upload ──────────────────────────────────────────────────────────┐
   │ POST /api/files/upload-url                                               │
   │    → row created status='uploading', expected_size set                  │
   │    → returns presigned PUT URL + file_id + required_headers             │
   │      + wrapped content key (client seals with this)                     │
   │                                                                          │
   │ Client seals document (AES-256-GCM) → PUT ciphertext → bucket           │
   │                                                                          │
   │ POST /api/files/{id}/complete                                            │
   │    → server stats the object; reads first ~4 KiB; DECRYPTS; sniffs      │
   │    → allowlist check (magic-byte + extension); reject+delete if failed  │
   │    → computes content_hash = SHA-256(ciphertext); appends version v1    │
   │    → status='ready'                                                     │
   │    OR                                                                    │
   │ POST /api/files/{id}/abort  → row + object deleted                       │
   └──────────────────────────────────────────────────────────────────────────┘
```

**Filtering.** Every list/search/editor path excludes `status != 'ready'` rows — an `uploading` object has no committed version yet. Quota math counts uploading rows against the workspace cap (committed at presign) so two parallel uploads can't both squeeze under the limit.

**Stale uploads.** A background janitor (already scheduled hourly by `sessions::delete_expired`) sweeps `status='uploading' AND created_at < now() - 1h`, deleting the row + best-effort the object. The hook is in place; v0 ships it active because a failed sniff or dropped client leaves orphans that must not linger.

## Schema (migration 0009)

```sql
ALTER TABLE files ADD COLUMN status TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE files ADD COLUMN expected_size INTEGER;
CREATE INDEX files_status_idx ON files(status);
```

Backward compatible: existing rows materialise as `status='ready'`. The wrapped content key is ephemeral (returned once at presign, never persisted); the committed version's blob is self-describing (`nonce ‖ ciphertext ‖ tag`) and decrypts under the workspace DEK like any other.

## Endpoints

### `POST /api/files/upload-url` — presign

Workspace-member scoped. Body:

```json
{
  "name": "annual-report.pdf",
  "size": 41234567,
  "content_type": "application/pdf",
  "parent_id": null,
  "workspace_id": "wsp_…"
}
```

Server:

1. Resolve workspace via `resolve_active_workspace` (membership-gated).
2. Validate name (`sanitise_display_name`).
3. **Extension allowlist check** (documents-only). Reject at presign if the extension isn't `docx/xlsx/xlsm/pptx/pdf/md/txt/csv/json/yaml` — defense-in-depth ahead of the finalize sniff.
4. Quota check: `used_bytes(workspace) + sum(expected_size where status='uploading') + size <= quota`.
5. Resolve storage adapter via `StorageRegistry::for_workspace` (BYO when set, default otherwise). Return **409** if adapter is `fs`/`memory` — SPA falls back to proxy.
6. Generate file id + **opaque ULID storage key** (never derived from the name), insert row `status='uploading'`, `expected_size = size`, `size = 0`, `content_type = body.content_type`, `storage_id` matching the resolved adapter.
7. Mint a per-upload **content key**, wrap it under the workspace DEK (`dochub-crypto`), and mint the signed PUT via `Storage::signed_put(key, ttl=15min)`.
8. Emit `files.upload_url_minted` audit event.
9. Return:

```json
{
  "file_id": "01H…",
  "upload_url": "https://my-bucket.s3.amazonaws.com/01H…?X-Amz-…",
  "expires_at": "2026-07-06T05:30:00Z",
  "method": "PUT",
  "required_headers": { "Content-Type": "application/octet-stream" },
  "encryption": { "alg": "AES-256-GCM", "wrapped_key": "base64…" }
}
```

The bucket receives `Content-Type: application/octet-stream` — it stores an opaque ciphertext blob, not a document. Errors: `400` validation / disallowed extension, `403` non-member, `409` adapter doesn't presign, `413` quota exceeded.

### `POST /api/files/{id}/complete` — finalize

Workspace-member scoped. Body empty.

1. Look up the row; must be `status='uploading'` and caller a workspace member.
2. `storage.stat(key)` against the resolved adapter.
   - 404 → row stays `uploading`, return 404 (client retries the PUT).
3. **Decrypt-and-sniff (mandatory).** Read the first ~4 KiB via the adapter, unwrap the content key, decrypt, run `infer` magic-byte sniff + extension allowlist. On mismatch → delete the object, mark the row rejected (or delete it), emit `files.upload_rejected`, return `415`.
4. Compute `content_hash = SHA-256(ciphertext)` (streaming read) and **append version v1** to `file_versions` (`prev_hash = NULL`, the chain root). Update the row: `size = stat.size`, `etag = stat.etag`, `content_type` = sniffed type, `status = 'ready'`, clear `expected_size`.
5. Emit `files.upload_completed` audit event.
6. Return the standard `FileDto`.

### `POST /api/files/{id}/abort` — cancel

Workspace-member scoped. Deletes the row and best-effort deletes the object. Idempotent (404 on already-gone rows is silent). No version is ever chained for an aborted upload.

## Storage facade changes

`Storage::signed_put` already returns `SignedUrl::Native { url, expires_at }` for S3/MinIO/R2/B2 and `SignedUrl::Token { token, expires_at }` for fs/memory. The presign handler returns 409 on the Token variant — the SPA shouldn't hit this (it only opts in for native-presign BYO), but defense-in-depth.

New helpers:

```rust
impl StorageRegistry {
    /// True when the adapter can serve a direct upload (signed_put returns Native).
    pub fn supports_direct_upload(&self, /* …adapter ref… */) -> bool;
}

impl dochub_crypto::Envelope {
    /// Mint a per-upload content key wrapped under the workspace DEK, for client-side sealing.
    pub fn grant_content_key(&self, workspace_id: &str) -> Result<WrappedKey, CryptoError>;
    pub fn unwrap_content_key(&self, workspace_id: &str, wrapped: &WrappedKey) -> Result<ContentKey, CryptoError>;
}
```

The SPA learns its policy via `/api/me/upload-policy` (native-presign? client-seal supported?).

## SPA branching

`uploadFile` in `api/client.ts`:

```ts
export async function uploadFile(file, parentId, workspaceId) {
  if (shouldDirectUpload(file)) {
    try {
      return await directUpload(file, parentId, workspaceId);
    } catch (e) {
      // 409 (adapter doesn't presign), no-WebCrypto, or CORS/network hiccup.
      // Fall back so the document still lands — sealed in-process on the proxy path.
      console.warn("direct upload fell back to proxy:", e);
    }
  }
  return proxyUpload(file, parentId, workspaceId);
}

function shouldDirectUpload(file) {
  if (!import.meta.env.VITE_DIRECT_UPLOAD) return false;
  if (!window.crypto?.subtle) return false;          // must be able to seal client-side
  return file.size >= 8 * 1024 * 1024;
}
```

`directUpload`:

1. `POST /api/files/upload-url` → `{ upload_url, file_id, encryption.wrapped_key }`.
2. Seal the document with WebCrypto `AES-GCM` using the granted key → `nonce ‖ ciphertext ‖ tag`.
3. `fetch(upload_url, { method: "PUT", headers: required_headers, body: sealed })`.
4. `POST /api/files/{id}/complete` → returns the same `FileDto` the proxy path would (after the server's decrypt-and-sniff).
5. On any failure between 1–4: best-effort `POST /api/files/{id}/abort`, then surface the error.

## Audit

| Action | Metadata |
|---|---|
| `files.upload_url_minted` | `size`, `content_type`, `workspace_id` |
| `files.upload_completed` | `size`, `etag`, `content_hash`, `sniffed_type`, `direct=true` |
| `files.upload_rejected` | `reason` (`disallowed_type` / `sniff_mismatch`) |
| `files.upload_aborted` | `reason` (best-effort string from the SPA) |
| `files.upload_stale_swept` | (background janitor) |

Content keys never appear in audit metadata or logs (per the security checklist).

## CORS implications

The bucket needs `PUT` allowed from the SPA origin. Operators self-configure:

- AWS S3 / MinIO / Cloudflare R2 / Backblaze B2: bucket CORS rule with `AllowedMethod: PUT`, `AllowedOrigin: <hub app origin>`, and `AllowedHeader` covering `Content-Type`.

The install doc ships a snippet per provider. Without CORS the browser blocks the PUT and the SPA falls back to proxy (console warning + one-time toast pointing at the docs).

## Security checklist (per CLAUDE.md)

- ✅ **No plaintext at rest.** The client seals before PUT (or the gateway seals before write); the bucket only ever holds ciphertext. Same invariant as the proxy path, verified by the spy-backend test on the proxy path and by a decrypt round-trip on finalize.
- ✅ **Documents-only allowlist enforced on the direct path** — extension check at presign *and* magic-byte sniff at finalize (server decrypts the head). This is now v0, not deferred; the direct path is not exempt from Testing invariant #8.
- ✅ Workspace membership gate at presign + complete + abort.
- ✅ Quota committed at presign — parallel uploads can't both fit.
- ✅ Immutability preserved — the object becomes version v1 only after sniff passes; `content_hash` computed on finalize; aborted/rejected uploads never chain.
- ✅ Storage key is `ulid::Ulid::new()` (never derived from input); bucket blobs are opaque.
- ✅ Rate limit: `upload_limiter` token bucket gates `/api/files/upload-url`.
- ✅ Audit on every state transition (mint, complete, reject, abort).
- ✅ Presigned URL + content-key grant TTL: **15 min** — long enough for a flaky connection on a big PDF, short enough that a leaked URL/grant expires before it's useful.

## Out of scope (v0.2+)

- Multipart / chunked upload protocol (very large documents).
- Resumable uploads (tus.io).
- Progress reporting beyond the PUT's native `progressEvent`.
- Gateway-encryption deployment as a first-class shipped component (the client-side path is primary; the gateway is documented as an alternative, not packaged in v0).
