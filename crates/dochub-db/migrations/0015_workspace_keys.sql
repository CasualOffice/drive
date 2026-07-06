-- Per-workspace data-encryption keys (build spec §3). One row per workspace,
-- created on first document write. The DEK is stored ONLY wrapped: `wrapped_dek`
-- is base64 of the `WrappedDek` ciphertext envelope
-- (`0x01 ‖ nonce ‖ ct ‖ tag`) produced by the master KEK. Plaintext DEKs live
-- only in memory (zeroized on drop) and never touch this table.
--
-- `key_version` records which KEK sealed the row so a future master-key
-- rotation can re-wrap without rewriting any document blob. Portable across
-- SQLite + Postgres (TEXT ULIDs / base64, ISO-8601 UTC, INTEGER version).

CREATE TABLE workspace_keys (
  workspace_id  TEXT PRIMARY KEY REFERENCES workspaces(id),
  wrapped_dek   TEXT NOT NULL,
  key_version   INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);
