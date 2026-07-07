-- Phase 3 P3.1 — content-search index bookkeeping (build spec §1).
--
-- The Tantivy content index (`dochub-index`) is driven lazily off the `files`
-- table. Two columns track per-file indexing state so the reindex pass knows
-- what still needs work without a separate queue table:
--
--   index_state  — lifecycle: 'pending' (needs indexing, the default for every
--                  new + backfilled row), 'ready' (content indexed), 'unsupported'
--                  (indexed by title/extension only — docx/xlsx/pptx/pdf content
--                  extraction is a documented `core` follow-up), or 'trashed'
--                  (removed from the index after tombstone/trash).
--   indexed_hash — the head `content_hash` the current index entry was built
--                  from. When a new version moves the head, the head hash no
--                  longer matches this and the file is reindexed. NULL until
--                  first indexed.
--
-- Portable across SQLite + Postgres: TEXT columns, no enum/JSONB. Existing rows
-- backfill to 'pending' so they get indexed on the next search of their
-- workspace.

ALTER TABLE files ADD COLUMN index_state TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE files ADD COLUMN indexed_hash TEXT;

CREATE INDEX files_index_state_idx ON files(workspace_id, index_state);
