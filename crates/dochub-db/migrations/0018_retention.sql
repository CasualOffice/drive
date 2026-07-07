-- Retention policies (build spec §3 — P1.2 compliance layer).
--
-- A retention policy declares the minimum history a workspace must keep before
-- any *permanent purge* is permitted. Phase 1 is `retain`-only: policies never
-- auto-delete anything (D2 — auto-purge is Phase 4). They are consulted by the
-- purge guard in `dochub-http` to reject permanent erasure of versions that are
-- still inside the `min_age_days` window or that a purge would drop below
-- `min_versions`. Trash / tombstone (`files.trashed_at`) is always allowed under
-- retention — only permanent purge is gated.
--
-- `scope` is `'workspace'` in Phase 1 (`'project'` / `'tag'` land later).
-- Portable across SQLite + Postgres: TEXT ULIDs, ISO-8601 UTC timestamps,
-- nullable INTEGER counters. No JSONB / enum / native UUID.

CREATE TABLE retention_policies (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id),
  scope         TEXT NOT NULL,                  -- 'workspace' (Phase 1)
  min_versions  INTEGER,                        -- keep at least N versions (NULL = all)
  min_age_days  INTEGER,                        -- keep for at least N days (NULL = forever)
  mode          TEXT NOT NULL DEFAULT 'retain', -- 'retain' only in P1 (no auto-purge)
  created_at    TEXT NOT NULL
);

CREATE INDEX retention_policies_ws_idx ON retention_policies(workspace_id);
