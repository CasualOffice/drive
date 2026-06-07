-- Phase 2: scope files + folders to a workspace.
-- Pipeline §8.8. Spec: docs/ux/13-workspaces-surface.md.
--
-- Adds workspace_id columns (nullable for ALTER-TABLE portability), backfills
-- from the owner's Personal workspace, then adds an index for the new
-- scoping query path. Existing rows whose owner happens not to have a
-- Personal workspace (shouldn't happen in v0 — every user gets one at
-- insert) keep NULL; handlers treat NULL as "Personal of owner" as a
-- defensive fallback.

ALTER TABLE files ADD COLUMN workspace_id TEXT;
UPDATE files
SET workspace_id = (
  SELECT id FROM workspaces
  WHERE workspaces.owner_id = files.owner_id AND workspaces.kind = 'personal'
  LIMIT 1
)
WHERE workspace_id IS NULL;
CREATE INDEX files_workspace_id_idx ON files(workspace_id);

ALTER TABLE folders ADD COLUMN workspace_id TEXT;
UPDATE folders
SET workspace_id = (
  SELECT id FROM workspaces
  WHERE workspaces.owner_id = folders.owner_id AND workspaces.kind = 'personal'
  LIMIT 1
)
WHERE workspace_id IS NULL;
CREATE INDEX folders_workspace_id_idx ON folders(workspace_id);
