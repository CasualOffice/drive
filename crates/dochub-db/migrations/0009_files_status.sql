-- Pipeline §13.6 — direct-to-storage upload.
-- Spec: docs/research/10-direct-upload.md.
--
-- A file row now passes through `uploading → ready` (or `failed`) for the
-- direct-PUT path. The proxy multipart path skips the intermediate state
-- and inserts as `ready` directly. Existing rows backfill to `ready` so
-- every list/search/preview path keeps showing them.

ALTER TABLE files ADD COLUMN status TEXT NOT NULL DEFAULT 'ready';

-- Bytes the SPA promised at presign time. Counts against the workspace
-- quota until the row flips to `ready` (real `size` takes over then).
-- Cleared (NULL) once finalize succeeds so the column doesn't accumulate
-- stale numbers.
ALTER TABLE files ADD COLUMN expected_size INTEGER;

CREATE INDEX files_status_idx ON files(status);
