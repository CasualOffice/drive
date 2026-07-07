-- Per-workspace Ed25519 provenance signing keys (Phase 1 build §2.1). One row
-- per workspace, created on first provenance export. The private key is stored
-- ONLY sealed: `wrapped_secret` is base64 of the 32-byte Ed25519 secret seed
-- sealed under the master KEK envelope (`0x01 ‖ nonce ‖ ct ‖ tag`), exactly like
-- a wrapped DEK. The plaintext seed lives only in memory (zeroized on drop) and
-- never touches this table.
--
-- `public_key` is base64 of the 32-byte Ed25519 verifying key — not secret; it
-- ships in the signed-provenance response so recipients verify offline.
--
-- Per-workspace scope (decision D1): tenant isolation, matching the DEK model.
-- Portable across SQLite + Postgres (TEXT ULIDs / base64, ISO-8601 UTC).

CREATE TABLE provenance_keys (
  workspace_id    TEXT PRIMARY KEY REFERENCES workspaces(id),
  wrapped_secret  TEXT NOT NULL,
  public_key      TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
