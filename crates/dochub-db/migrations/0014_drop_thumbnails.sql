-- Phase 0 narrow — Doc-Hub drops the thumbnail feature entirely. Documents
-- (not images) are the product; there is no server- or client-side thumbnail
-- path left, so the backing columns are removed.
--
-- Drops:
--   files.thumbnail            (0003) — client-generated data URI
--   files.thumbs_state         (0010) — server-side generation state
--   files.thumbs_generated_at  (0010) — last generation timestamp
--
-- Portable across SQLite (>= 3.35, bundled here is 3.46) and Postgres: both
-- support `DROP COLUMN`. SQLite refuses to drop an indexed column, so the
-- `thumbs_state` index is dropped first. `IF EXISTS` keeps the migration
-- idempotent on partially-migrated databases.

DROP INDEX IF EXISTS files_thumbs_state_idx;

ALTER TABLE files DROP COLUMN thumbnail;
ALTER TABLE files DROP COLUMN thumbs_state;
ALTER TABLE files DROP COLUMN thumbs_generated_at;
