-- Immutable, hash-chained version history (build spec §5 — the registry core).
--
-- Every committed save of a document appends one row here; rows are never
-- UPDATEd or DELETEd (history is append-only, CLAUDE.md inviolable rule 6).
-- `files.version` is the head pointer = MAX(seq) for the file.
--
-- The chain: `content_hash` is SHA-256(ciphertext) as lowercase hex — the same
-- hash the content-addressed `versions/{hash}` storage key is built from — and
-- `prev_hash` points at the previous version's `content_hash` (NULL at seq=1).
-- Verification recomputes each content hash from the stored ciphertext and
-- walks the pointers; the first disagreement is a tamper alarm.
--
-- Portable across SQLite + Postgres: TEXT ULIDs / hex / base64, ISO-8601 UTC
-- timestamps, INTEGER counters. No JSONB / enum / native UUID.

CREATE TABLE file_versions (
  file_id       TEXT NOT NULL REFERENCES files(id),
  seq           INTEGER NOT NULL,          -- 1-based, monotone per file
  storage_key   TEXT NOT NULL,             -- versions/{content_hash}
  size          INTEGER NOT NULL,          -- plaintext (logical document) byte length
  content_hash  TEXT NOT NULL,             -- SHA-256(ciphertext), lowercase hex
  prev_hash     TEXT,                      -- previous version's content_hash; NULL at seq=1
  author_id     TEXT NOT NULL REFERENCES users(id),
  reason        TEXT,                      -- e.g. "edit", "restore of v3", "import"
  created_at    TEXT NOT NULL,
  PRIMARY KEY (file_id, seq)
);

CREATE INDEX file_versions_file_idx ON file_versions(file_id, seq DESC);
CREATE INDEX file_versions_hash_idx ON file_versions(content_hash);
