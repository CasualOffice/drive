-- Casual Drive v0 schema. Portable across SQLite and Postgres:
--   * IDs are TEXT (ULID strings, 26 chars)
--   * Timestamps are TEXT in ISO-8601 UTC ("2026-06-07T01:23:45.678Z")
--   * Booleans are INTEGER 0/1 (SQLite has no bool; PG accepts via ::INT cast)
--   * No JSONB, no UUID native type, no enum types — keep portable

-- Single-tenant v0 has exactly one admin row, but the table is multi-user
-- shaped so Phase 3's OIDC drop-in is a config flip, not a migration.
CREATE TABLE users (
  id              TEXT PRIMARY KEY,
  username        TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  is_admin        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);

-- Server-side session store. The cookie carries only the session id; the
-- CSRF token lives server-side, fetched per response.
CREATE TABLE sessions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  csrf_token      TEXT NOT NULL,
  expires_at      TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX sessions_user_id_idx     ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx  ON sessions(expires_at);

-- Folder hierarchy. parent_id NULL = root.
CREATE TABLE folders (
  id                  TEXT PRIMARY KEY,
  parent_id           TEXT REFERENCES folders(id),
  name                TEXT NOT NULL,
  owner_id            TEXT NOT NULL REFERENCES users(id),
  trashed_at          TEXT,
  original_parent_id  TEXT,
  created_at          TEXT NOT NULL,
  modified_at         TEXT NOT NULL
);
CREATE INDEX folders_parent_id_idx  ON folders(parent_id);
CREATE INDEX folders_owner_id_idx   ON folders(owner_id);
CREATE INDEX folders_trashed_at_idx ON folders(trashed_at);

-- Files. Storage key is conventionally "files/{id}" (see ARCHITECTURE §"Storage facade").
CREATE TABLE files (
  id                  TEXT PRIMARY KEY,
  parent_id           TEXT REFERENCES folders(id),
  name                TEXT NOT NULL,
  size                INTEGER NOT NULL DEFAULT 0,
  content_type        TEXT,
  etag                TEXT,
  version             INTEGER NOT NULL DEFAULT 1,
  owner_id            TEXT NOT NULL REFERENCES users(id),
  trashed_at          TEXT,
  original_parent_id  TEXT,
  created_at          TEXT NOT NULL,
  modified_at         TEXT NOT NULL
);
CREATE INDEX files_parent_id_idx  ON files(parent_id);
CREATE INDEX files_owner_id_idx   ON files(owner_id);
CREATE INDEX files_trashed_at_idx ON files(trashed_at);

-- WOPI lock state — one row per locked file. Phase 1 may still cache locks
-- in memory for hot files; the DB row is the source of truth.
CREATE TABLE wopi_locks (
  file_id         TEXT PRIMARY KEY REFERENCES files(id),
  lock_id         TEXT NOT NULL,
  acquired_at     TEXT NOT NULL,
  expires_at      TEXT NOT NULL
);
CREATE INDEX wopi_locks_expires_at_idx ON wopi_locks(expires_at);

-- Share-links. Either file_id or folder_id is set, not both (enforced in app).
CREATE TABLE share_links (
  id                TEXT PRIMARY KEY,
  token             TEXT NOT NULL UNIQUE,
  file_id           TEXT REFERENCES files(id),
  folder_id         TEXT REFERENCES folders(id),
  password_hash     TEXT,
  permissions       TEXT NOT NULL,
  expires_at        TEXT,
  created_at        TEXT NOT NULL,
  created_by        TEXT NOT NULL REFERENCES users(id),
  last_accessed_at  TEXT,
  access_count      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX share_links_token_idx   ON share_links(token);
CREATE INDEX share_links_file_id_idx ON share_links(file_id);
