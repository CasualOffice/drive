-- Chunk embeddings for the RAG layer (Phase 5). Each row is one chunk of a
-- file's head content plus its embedding vector, produced by the `embed_file`
-- job (dochub-worker) from `dochub_core::extract` text + `dochub-ai` chunk +
-- embed. Semantic search embeds the query and ranks these by cosine similarity.
--
-- Portable across SQLite + Postgres (TEXT ULIDs / base64, ISO-8601 UTC, INTEGER
-- counts). The vector is stored as base64 of its little-endian f32 bytes in a
-- TEXT column — same convention as wrapped_dek / wrapped_secret — so no BLOB vs
-- BYTEA divergence and no vector extension (nearest-neighbour is a brute-force
-- cosine scan in Rust, which is fine at per-workspace scale).

CREATE TABLE embeddings (
  id            TEXT PRIMARY KEY,
  file_id       TEXT NOT NULL,
  workspace_id  TEXT NOT NULL,
  -- 0-based chunk position within the file's head content.
  chunk_index   INTEGER NOT NULL,
  -- Head content_hash this embedding was built from — lets the embed job skip
  -- files whose head is unchanged, and detect staleness.
  content_hash  TEXT NOT NULL,
  -- Vector dimensionality (embedder-dependent), stored for a fast mismatch
  -- guard before decoding.
  dims          INTEGER NOT NULL,
  -- base64(little-endian f32 * dims). Opaque bytes to the DB.
  vector        TEXT NOT NULL,
  -- The chunk text, returned as the retrieval snippet / RAG context.
  chunk_text    TEXT NOT NULL,
  char_start    INTEGER NOT NULL,
  char_end      INTEGER NOT NULL,
  created_at    TEXT NOT NULL
);
-- Retrieval scans one workspace's vectors; re-embed deletes by file.
CREATE INDEX embeddings_workspace_idx ON embeddings(workspace_id);
CREATE INDEX embeddings_file_idx ON embeddings(file_id);
