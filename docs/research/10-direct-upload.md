# 10 — Direct-to-storage upload

Pipeline §13.6. Lets the client `PUT` bytes straight at the configured storage backend (S3, MinIO, R2, B2) without proxying through the Drive process. For everything else (filesystem, in-memory, or workspaces with no native-presign capability) the existing multipart proxy stays the path.

## Why

- **Throughput.** A 2 GB video pushed through `axum::Multipart` ties up a Drive worker for the duration. Direct PUT lets the client and the bucket talk over the user's own bandwidth.
- **Cost.** Cuts egress + CPU on the Drive host. Operators running on a $5 VPS care.
- **Failure isolation.** A truncated multipart used to dirty the request body; a failed direct PUT just leaves a half-uploaded object in the bucket that we clean up on `abort` or never finalize.

Out of scope: multipart (chunked) upload protocol — the bucket's native multipart isn't exposed in v0. Single-PUT object size is bounded by the provider (5 GB on S3 without chunking). Resumable is `⏸ v0.2+` per pipeline §6.7.

## When the direct path activates

Only when **all three** are true:

1. The workspace's effective storage adapter is one of `s3`, `minio`, `r2`, `b2` (native `presign_write` is available). `fs` and `memory` always use the proxy.
2. The file is **≥ 8 MiB** at the SPA boundary (smaller files don't benefit; the proxy round-trip is cheaper than the extra metadata roundtrip).
3. The client opts in via a feature flag (`VITE_DIRECT_UPLOAD=1`) for the first release. After two weeks of beta it flips on by default.

Below those thresholds the SPA uses the existing `POST /api/files` multipart path.

## File lifecycle (with status)

Today a `files` row is either present (ready) or trashed. Direct upload introduces a third state for the window between presign and finalize:

```
                          ┌─ proxy upload (single multipart) ──────┐
                          │   POST /api/files                      │
                          │      → row created with status='ready' │
                          └────────────────────────────────────────┘

   ┌─ direct upload ──────────────────────────────────────────────────┐
   │ POST /api/files/upload-url                                       │
   │    → row created with status='uploading', expected_size set      │
   │    → returns presigned PUT URL + file_id + required_headers      │
   │                                                                  │
   │ Client PUT bytes → bucket                                        │
   │                                                                  │
   │ POST /api/files/{id}/complete                                    │
   │    → server stats the object, fills size + etag + content_type,  │
   │       flips status='ready'                                       │
   │    OR                                                            │
   │ POST /api/files/{id}/abort                                       │
   │    → row + object deleted (we trust the client to call this)     │
   └──────────────────────────────────────────────────────────────────┘
```

**Filtering.** Every existing list/search/preview path must exclude `status != 'ready'` rows. Quota math counts uploading rows against the workspace cap (committed at presign) so two parallel direct uploads can't both squeeze under the limit.

**Stale uploads.** A background janitor (already scheduled hourly by `sessions::delete_expired`) extends to sweep `status='uploading' AND created_at < now() - 1h`, deleting the row + best-effort the object. v0 ships the janitor as a no-op (the SPA always calls `complete` or `abort`); the hook is in place for future toughening.

## Schema (migration 0009)

```sql
ALTER TABLE files ADD COLUMN status TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE files ADD COLUMN expected_size INTEGER;
CREATE INDEX files_status_idx ON files(status);
```

Backward compatible: all existing rows materialise as `status='ready'`. Migration code never has to touch them.

## Endpoints

### `POST /api/files/upload-url` — presign

Owner-scoped (workspace member). Body:

```json
{
  "name": "video.mp4",
  "size": 412345678,
  "content_type": "video/mp4",
  "parent_id": null,
  "workspace_id": "wsp_…"
}
```

Server:

1. Resolve workspace via `resolve_active_workspace` (membership-gated).
2. Validate name (existing `sanitise_display_name`).
3. Reject if extension is in the blocklist (existing `check_upload_extension`). Defense-in-depth — the bucket doesn't sniff but the row metadata still records the extension.
4. Quota check: `used_bytes(workspace) + sum(expected_size where status='uploading') + size <= quota`.
5. Resolve storage adapter via `StorageRegistry::for_workspace` (returns BYO when set, default otherwise). Return **409** if adapter is `fs`/`memory` — surface to SPA so it falls back to proxy.
6. Generate file id (ULID), insert row with `status='uploading'`, `expected_size = size`, `size = 0`, `content_type = body.content_type`, `etag = NULL`, `storage_id` matching the resolved adapter.
7. Mint signed PUT via `Storage::signed_put(key, ttl=15min)`.
8. Emit `files.upload_url_minted` audit event.
9. Return:

```json
{
  "file_id": "01H…",
  "upload_url": "https://my-bucket.s3.amazonaws.com/01H…?X-Amz-…",
  "expires_at": "2026-06-08T05:30:00Z",
  "method": "PUT",
  "required_headers": { "Content-Type": "video/mp4" }
}
```

Errors: `400` validation, `403` non-member, `409` adapter doesn't presign, `413` quota exceeded.

### `POST /api/files/{id}/complete` — finalize

Owner-scoped on the file's workspace. Body empty.

1. Look up the row; must be `status='uploading'` and the caller must be a workspace member.
2. `storage.stat(key)` against the resolved adapter.
   - If 404 → row stays `uploading` + return 404 to SPA (client retries the PUT).
   - If stat succeeds → update row: `size = stat.size`, `etag = stat.etag`, `content_type = stat.content_type ?? row.content_type`, `status = 'ready'`. Bump `modified_at`. Clear `expected_size` (set NULL).
3. Emit `files.upload_completed` audit event.
4. Return the standard `FileDto` shape (matches the existing multipart response).

### `POST /api/files/{id}/abort` — cancel

Owner-scoped. Deletes the row and best-effort deletes the object. Idempotent (404 on already-gone rows is silent).

## Storage facade changes

`Storage::signed_put` already returns `SignedUrl::Native { url, expires_at }` for S3/MinIO and `SignedUrl::Token { token, expires_at }` for fs/memory. The presign handler returns 409 when it sees the Token variant — the SPA's branch logic shouldn't hit this in practice (it only opts in when the workspace's BYO is native-presign), but defense-in-depth.

New helper:

```rust
impl StorageRegistry {
    /// Returns true when the adapter can serve a direct upload (i.e.
    /// `signed_put` returns Native). Asks OpenDAL once per cache hit.
    pub fn supports_direct_upload(&self, /* …adapter ref… */) -> bool;
}
```

In practice the SPA learns this via `/api/me` or a new `/api/me/upload-policy` endpoint — see §"SPA branching" below.

## SPA branching

`uploadFile` in `api/client.ts` becomes:

```ts
export async function uploadFile(file, parentId, thumb, workspaceId) {
  if (shouldDirectUpload(file)) {
    try {
      return await directUpload(file, parentId, thumb, workspaceId);
    } catch (e) {
      // Most likely 409 (adapter doesn't presign) or a CORS / network
      // hiccup during the PUT. Fall back so the file still lands.
      console.warn("direct upload fell back to proxy:", e);
    }
  }
  return proxyUpload(file, parentId, thumb, workspaceId);
}

function shouldDirectUpload(file) {
  if (!import.meta.env.VITE_DIRECT_UPLOAD) return false;
  return file.size >= 8 * 1024 * 1024;
}
```

`directUpload`:

1. `POST /api/files/upload-url` with metadata + workspace.
2. `fetch(upload_url, { method: "PUT", headers: required_headers, body: file })` — uses the browser's native streaming `Body` so no `arrayBuffer()` materialisation.
3. `POST /api/files/{id}/complete` → returns the same `FileDto` the proxy path would have.
4. On any failure between 1 and 3: best-effort `POST /api/files/{id}/abort`, then surface the error.

The thumbnail is uploaded with `complete` (not posted to the bucket separately).

## Audit

| Action | Metadata |
|---|---|
| `files.upload_url_minted` | `size`, `content_type`, `workspace_id` |
| `files.upload_completed` | `size`, `etag`, `direct=true` |
| `files.upload_aborted` | `reason` (best-effort string from the SPA) |
| `files.upload_stale_swept` | (background janitor — v0.2+) |

## CORS implications

The bucket needs `PUT` allowed from the SPA origin. Operators self-configure:

- AWS S3: bucket CORS rule with `AllowedMethod: PUT`, `AllowedOrigin: <drive origin>`.
- MinIO: similar via `mc anonymous` or the admin console.
- Cloudflare R2: dashboard CORS settings.
- Backblaze B2: bucket CORS rules.

The install doc gets a snippet for each provider. Without CORS, the browser blocks the PUT and the SPA falls back to proxy (with a console warning + a one-time toast suggesting the docs).

## Security checklist (per CLAUDE.md)

- ✅ Workspace membership gate at presign + complete + abort.
- ✅ Quota committed at presign — parallel uploads can't both fit.
- ✅ Magic-byte sniffing — **not in v0** for direct uploads because the server never sees the bytes. Mitigation: the row records the client-asserted MIME, the `/raw/{token}` user-content origin still forces `Content-Disposition: attachment` for non-previewable types + ships its own sandboxed CSP. v0.2+: add a server-side post-finalize sniff that downloads the first 4 KB via the storage adapter, runs `infer`, and updates `content_type` (rejects executables). Tracked in §13.6a.
- ✅ Rate limit: the existing `upload_limiter` token bucket gates `/api/files/upload-url` (1 mint per upload slot) instead of the PUT (which the SPA + bucket handle).
- ✅ Audit on every state transition (mint, complete, abort).
- ✅ Storage key remains `ulid::Ulid::new()` (never derived from input).
- ✅ Presigned URL TTL: **15 min** (cap on `signed_put`) — long enough for a flaky mobile connection on a 2 GB file, short enough that a leaked URL stops working before the next coffee.

## Out of scope (v0.2+)

- **§13.6a** — post-finalize magic-byte sniff (download first 4 KB via adapter, run `infer`, reject if executable). Adds one storage round-trip per finalize; worth doing before a multi-tenant production deploy.
- Multipart / chunked upload protocol (5 GB+ files).
- Resumable uploads (tus.io).
- Progress reporting beyond the PUT's native `progressEvent` (which isn't exposed by `fetch`; would require XHR).
- A janitor that sweeps stale `uploading` rows (the hook is in place; the cron is a v0.2 follow-up).
