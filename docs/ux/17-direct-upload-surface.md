# 17 — Direct upload surface

Companion to `docs/research/10-direct-upload.md`. The SPA's user-visible behaviour for the direct-to-storage upload path.

## What the user sees

**Nothing different.** The upload card, drag-drop ghost rows, progress chip, and toast messages stay identical to the proxy path. Direct upload is a transparent performance optimisation, not a user-facing feature.

Two exceptions, both quiet:

1. **First-time CORS failure** → bottom toast: "Upload took the slow path. Ask your admin to add CORS rules for your bucket — see Docs → Configuration." Surfaces once per session per workspace; dismissed on click.
2. **Quota refused at presign** (413 from `/api/files/upload-url`) → same toast the proxy path shows today: "Out of space. Need more? Settings → Storage → Request upgrade."

No new card, no new toggle in Settings.

## Internal flow (developer-visible)

```
SPA                              Drive                 Bucket
 │                                 │                     │
 │── POST /api/files/upload-url ──▶│                     │
 │   { name, size, ct, parent_id,  │                     │
 │     workspace_id }              │                     │
 │                                 │                     │
 │   201 ◀── { file_id, upload_url,│                     │
 │            expires_at, method,  │                     │
 │            required_headers }   │                     │
 │                                 │                     │
 │── PUT upload_url ─────────────────────────────────────▶│
 │                                                       │
 │   200 ◀────────────────────────────────────────────── │
 │                                 │                     │
 │── POST /api/files/{id}/complete▶│                     │
 │                                 │── stat(key) ───────▶│
 │                                 │   meta ◀────────────│
 │                                 │                     │
 │   200 ◀── FileDto               │                     │
```

Failure modes:

- **Presign rejected (409 adapter).** SPA falls through to proxy. No user toast.
- **PUT blocked by CORS / network.** SPA calls `abort`, then retries via proxy. Surfaces the one-time "slow path" toast.
- **PUT succeeds, complete returns 404.** SPA retries `complete` up to 3× with backoff (the bucket may be eventually-consistent on stat for the object that was just written). After 3, gives up + toasts: "Upload finished but the server can't see it yet — refresh in a minute."

## States checklist

- **Selecting workspace mid-upload:** if the user switches workspaces during a direct upload, `complete` still hits the original workspace (the file_id is locked in). The file appears in the original workspace's listing.
- **Tab closed mid-upload:** the row is left in `status='uploading'`. The v0.2 janitor sweeps it. v0 keeps the row indefinitely until manual cleanup or another upload of the same name in the same folder.
- **Quota exhausted by parallel uploads:** the second presign request's quota check sees the first's `expected_size` and refuses with 413. SPA shows the existing quota-exceeded toast.

## Out of scope

- Progress bar % during the PUT (fetch can't stream progress on upload). v0.2 considers XHR fallback.
- "Resume failed upload" UI.
- Multipart UI affordances for >5 GB single objects.
