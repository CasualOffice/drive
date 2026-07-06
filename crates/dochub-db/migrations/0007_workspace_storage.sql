-- Pipeline §8.9 — bring-your-own storage per workspace.
-- Spec: docs/research/08-byo-storage.md.
--
-- Each Team workspace can pin its own S3-compatible bucket + credentials.
-- Personal workspaces never get a row here (always = server default).
-- The encrypted secret blob is opaque to the database — AES-256-GCM
-- sealed in drive-storage with the host's DRIVE_STORAGE_SECRET_KEY.

CREATE TABLE workspace_storage (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL UNIQUE,
  provider        TEXT NOT NULL,
  bucket          TEXT NOT NULL,
  region          TEXT NOT NULL,
  endpoint        TEXT,
  access_key_id   TEXT NOT NULL,
  -- BASE64(nonce(12) || ciphertext || tag(16)). Never plaintext.
  secret_ct       TEXT NOT NULL,
  -- Bumped on every credential edit so cached adapters invalidate.
  key_version     INTEGER NOT NULL DEFAULT 1,
  tested_at       TEXT,
  tested_ok       INTEGER NOT NULL DEFAULT 0,
  tested_error    TEXT,
  created_at      TEXT NOT NULL,
  modified_at     TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX workspace_storage_workspace_id_idx
  ON workspace_storage(workspace_id);

-- files.storage_id: NULL → server default adapter; non-NULL → workspace_storage.id.
-- The pointer is permanent on the row, so flipping storage later doesn't
-- orphan existing files (they stay on whichever bucket they were uploaded to).
ALTER TABLE files ADD COLUMN storage_id TEXT;
CREATE INDEX files_storage_id_idx ON files(storage_id);
