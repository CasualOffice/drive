-- Pipeline §5.4 — server-side multi-size thumbnails.
-- Spec: docs/research/11-server-thumbnails.md.
--
-- Marks the generation state of the three server-side thumbnails
-- (`thumbs/{id}/{small|medium|large}.png` in the same bucket as the
-- original). New rows start as `pending`; the lazy worker walks them on
-- first list-response demand.

ALTER TABLE files ADD COLUMN thumbs_state TEXT NOT NULL DEFAULT 'pending';
-- 'pending'     — never attempted
-- 'ready'       — all three sizes generated
-- 'unsupported' — file type can't be thumbnailed
-- 'failed'      — last attempt errored
ALTER TABLE files ADD COLUMN thumbs_generated_at TEXT;

CREATE INDEX files_thumbs_state_idx ON files(thumbs_state);
