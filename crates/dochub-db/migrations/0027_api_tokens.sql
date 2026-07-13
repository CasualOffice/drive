-- API tokens (personal access tokens) — bearer credentials that let a headless
-- agent reach the MCP endpoint without a browser session.
--
-- The plaintext token is shown once at creation and never stored; only its
-- SHA-256 hash (hex) is persisted and looked up by exact match (the token's
-- 256-bit entropy makes enumeration infeasible). Revocation is a tombstone
-- (`revoked_at`), never a row delete, so the record of issued credentials
-- survives for audit.
--
-- Portability (per 0001): TEXT ULID ids, ISO-8601 UTC timestamps, no native
-- bool/UUID/JSON types.

CREATE TABLE api_tokens (
  id           TEXT PRIMARY KEY,               -- ULID
  user_id      TEXT NOT NULL REFERENCES users(id),
  name         TEXT NOT NULL,                  -- human label ("laptop CLI")
  token_hash   TEXT NOT NULL,                  -- SHA-256 hex of the token
  created_at   TEXT NOT NULL,                  -- ISO-8601 UTC
  expires_at   TEXT,                           -- ISO-8601 UTC; NULL = no expiry
  last_used_at TEXT,                           -- ISO-8601 UTC; NULL = never used
  revoked_at   TEXT                            -- ISO-8601 UTC; NULL = active
);

CREATE UNIQUE INDEX api_tokens_hash_idx ON api_tokens(token_hash);
CREATE INDEX api_tokens_user_idx ON api_tokens(user_id);
