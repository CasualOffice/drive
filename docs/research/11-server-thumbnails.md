# 11 — Server-side multi-size thumbnails

Pipeline §5.4 (expanded). User-driven: "server-side thumbnail generation, different sizes, S3-hosted".

Client-side `generateThumbnail` (pipeline §5.2 + §5.3) already produces a 192-px-square data URI for images + videos. That covers the SPA's grid and list views nicely, but breaks down for:

1. **PDFs.** No client-side `<canvas>`-from-PDF path without dragging in PDF.js (~500 KB) just for thumbnails.
2. **Files uploaded by tools other than the SPA** — direct PUT, S3 sync, future API clients. The row lands without a thumbnail and the grid shows a procedural placeholder forever.
3. **Multiple sizes** — grid cards want ~256 px; the preview modal wants ~1024 px; a future masonry view wants ~96 px. One client-side 192-px PNG fits none of these well.

The server pass closes those gaps.

## Goals

1. Generate `small (96)`, `medium (256)`, `large (1024)` PNG thumbnails for every image, PDF, and video file in S3-hosted workspaces.
2. Sandbox the decode — image / PDF / video parsers are real CVE surface (per `06-security.md`). v0 lands the trait + the safe in-process image path; PDF / video decoders ship in a separate worker process in v0.2 once we have a container story for it.
3. Cache the result in the same bucket as the original under a deterministic key prefix; serve via the same `/raw/{token}` signed-URL path.
4. Lazy by default — the worker only runs when a list response would otherwise return a row with no thumbnail. Backfill happens on access, not at upload time. Avoids burning CPU on files no one looks at.

## Why lazy not eager

- Most files are touched once and then forgotten. Eager generation at upload time wastes CPU + storage on the long tail.
- Direct uploads (pipeline §13.6) don't touch the Drive process — eager generation would mean either downloading the bytes back on finalize (wasteful) or shipping a Lambda-style worker on the bucket (out of scope).
- Lazy means the SPA sees a procedural thumbnail on first paint, then upgrades to a real one on the second access. Acceptable UX trade.

## Storage layout

```
<bucket>/
  <ulid>                           ← original
  thumbs/<ulid>/small.png          ← 96×96, fit-cover, PNG
  thumbs/<ulid>/medium.png         ← 256×256, fit-cover, PNG
  thumbs/<ulid>/large.png          ← 1024×1024, fit-contain, PNG
```

Thumbnail keys are derived (`thumbs/{id}/{size}.png`) so anyone with the file id can request them — but the `/raw/{token}` token-issuance path is still membership-gated, so the threat surface matches the original. Deleting a file also deletes its `thumbs/{id}/` prefix in a follow-up bulk-delete (added in the same migration as the thumbnail trait).

Server-default fs/memory backends use the same path scheme (it's just a key, the backend doesn't care).

## Schema (migration 0010)

```sql
ALTER TABLE files ADD COLUMN thumbs_state TEXT NOT NULL DEFAULT 'pending';
-- 'pending'  — never attempted
-- 'ready'    — all three sizes generated
-- 'unsupported' — file type can't be thumbnailed (text, archive, …)
-- 'failed'   — last attempt errored (worker oom, decode crash, etc.)
ALTER TABLE files ADD COLUMN thumbs_generated_at TEXT;
```

Backward compat: every existing row starts as `pending`. The thumbnail worker visits them as the SPA asks.

## Trait

```rust
// drive-storage/src/thumbnails.rs
pub trait ThumbnailWorker: Send + Sync {
    /// Decode `bytes` (already known-typed) and emit a PNG of `size_px`
    /// dimensions. `kind` lets the impl pick image vs PDF vs video paths.
    async fn generate(
        &self,
        kind: ThumbnailKind,
        bytes: Bytes,
        size_px: u32,
    ) -> Result<Vec<u8>, ThumbnailError>;
}

pub enum ThumbnailKind { Image, Pdf, Video }
```

v0 ships an `ImageOnlyWorker` (in-process `image` crate, image-only, no PDF/video). PDF + video land in v0.2 inside a sandboxed subprocess.

## Pipeline (server)

On every list response that includes a `pending` file row whose kind is thumbnail-eligible (`image/* | application/pdf | video/*`):

1. Handler returns the list immediately with no thumbnail URLs for pending rows.
2. Spawn (don't await) a background task per pending file id. Task is bounded by a `Semaphore::new(N)` to cap concurrent decodes.
3. Task: `storage.get(key)` → `worker.generate(kind, bytes, 96 / 256 / 1024)` → `storage.put("thumbs/{id}/{size}.png", png)` × 3 → `UPDATE files SET thumbs_state='ready', thumbs_generated_at = now() WHERE id = ?`.
4. Failure modes: decoder crash sets `thumbs_state='failed'` + records nothing. Janitor retries `failed` rows once per day.

The SPA polls or refreshes — no live notification in v0. Future: SSE channel.

## Endpoints

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/files/{id}/thumb/{size}` | Returns a 302 to a signed `/raw/{token}` URL for the requested size. 404 when the file row is `pending` or `unsupported`. |
| `POST` | `/api/files/{id}/thumb/regenerate` | Owner-only. Forces the worker to re-run (e.g., after fixing a borked decoder). Returns 202 + the row's new state. |

The SPA's file DTO grows a `thumbs_state: 'pending' \| 'ready' \| 'unsupported' \| 'failed'` field + helper URLs:

```ts
{
  thumbs_state: "ready",
  thumb_urls: {
    small:  "/api/files/01H…/thumb/small",
    medium: "/api/files/01H…/thumb/medium",
    large:  "/api/files/01H…/thumb/large"
  }
}
```

## Security

- The decode trait is the **only** code that touches untrusted bytes. v0 in-process is safe for images via the `image` crate (vetted; latest fuzz coverage is in place); PDF / video paths are explicitly NOT shipped in-process — they land in the v0.2 subprocess wrapper.
- PDF / video decoders run with `RLIMIT_AS` (memory) + `RLIMIT_CPU` (time) + `seccomp` denying network when v0.2 lands.
- Image decode bounded at 50 MP (current `image` default) so a 200000×200000 PNG bomb returns an error rather than allocating the universe.
- Generated PNGs are server-controlled bytes; the `/raw/{token}` path's `Content-Disposition: attachment` is overridden to `inline` for these specific keys (the storage adapter learns a small allow-list of paths to mark inline).
- Thumbnail object keys are public-by-knowing-the-id; the `/raw/{token}` issuance still requires a workspace membership check on the parent file id.

## Out of scope (v0.2+)

- PDF + video decoders (require sandboxed subprocess).
- Different formats per size (WebP small, AVIF large).
- HEIC / RAW image support.
- Smart cropping (face detection, salient region).
- Backfill cron for old `pending` files (works fine on-access, but a nightly sweep would warm caches).
- SSE channel for "thumbnail ready, refresh this row".
- A janitor that GCs `thumbs/{id}/` after the parent file is hard-deleted (currently best-effort on `delete`).

## Interaction with §13.6 direct upload

The direct upload's `/api/files/{id}/complete` endpoint sets `thumbs_state = 'pending'` so the next list response triggers generation. Client-side thumbnail data URIs (from `generateThumbnail`) are still uploaded and stored on the row's existing `thumbnail` column — they serve as the immediate fallback while the server pass runs. Once the server thumbnails are ready, the SPA prefers the server-sized assets (sharper, type-aware).
