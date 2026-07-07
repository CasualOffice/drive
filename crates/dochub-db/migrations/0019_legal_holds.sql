-- Legal holds (build spec §3 — P1.2 compliance layer).
--
-- A legal hold freezes a file / project / workspace against destruction: while
-- an active hold (one whose `released_at` is NULL) covers a file — directly, via
-- its project (parent folder), or via its workspace — no destructive path may
-- tombstone or purge it. The `hold_guard` in `dochub-http` consults this table
-- on every destructive path and rejects with `409 UnderLegalHold`.
--
-- Releasing a hold stamps `released_at` (append-only in spirit: rows are never
-- deleted, so the compliance record of a hold having existed is permanent).
--
-- `target_kind` is `'file' | 'project' | 'workspace'`; `target_id` is the file
-- or project (folder) id, or NULL for a workspace-wide hold. Portable across
-- SQLite + Postgres: TEXT ULIDs, ISO-8601 UTC timestamps. No JSONB / enum /
-- native UUID.

CREATE TABLE legal_holds (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id),
  target_kind   TEXT NOT NULL,             -- 'file' | 'project' | 'workspace'
  target_id     TEXT,                      -- file/project id; NULL for workspace-wide
  reason        TEXT NOT NULL,
  placed_by     TEXT NOT NULL REFERENCES users(id),
  placed_at     TEXT NOT NULL,
  released_at   TEXT                       -- NULL = active
);

CREATE INDEX legal_holds_ws_idx ON legal_holds(workspace_id);
CREATE INDEX legal_holds_active_idx ON legal_holds(workspace_id, released_at);
