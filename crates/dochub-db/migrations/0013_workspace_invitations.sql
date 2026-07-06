-- MU1 — workspace invitations. Spec lives in
-- docs/research/18-workspace-invitations.md (TODO) and in the
-- `workspace-invitations` memory entry locked 2026-06-12.
--
-- Magic-link semantics: anyone with the URL can accept. The token is
-- the secret — no per-recipient email binding. Multi-use links cap at
-- `max_uses`; revocation flips `revoked_at`.
--
-- Acceptance creates a `workspace_members` row + (for anonymous
-- visitors) a fresh `users` row. The `created_by` column is the
-- inviter — used for the Settings → Members audit display.

CREATE TABLE workspace_invitations (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES workspaces(id),
  -- Random 32-byte URL-safe base64. The handler never logs it; the
  -- only API surfaces are the create response + the public peek /
  -- accept endpoints (which receive it in the path).
  token           TEXT NOT NULL UNIQUE,
  -- "member" | "admin". Owner role is never grantable via invite.
  role            TEXT NOT NULL,
  created_by      TEXT NOT NULL REFERENCES users(id),
  created_at      TEXT NOT NULL,
  -- ISO-8601 timestamp; NULL means "never expires".
  expires_at      TEXT,
  -- Default 1 = single-use. Acceptance hard-fails with 409 when
  -- `used_count >= max_uses`.
  max_uses        INTEGER NOT NULL DEFAULT 1,
  used_count      INTEGER NOT NULL DEFAULT 0,
  -- ISO-8601 timestamp of revoke. NULL when active. Accept paths
  -- check both this AND `expires_at` AND `max_uses` before admitting.
  revoked_at      TEXT
);

CREATE INDEX workspace_invitations_workspace_idx ON workspace_invitations(workspace_id);
CREATE INDEX workspace_invitations_token_idx ON workspace_invitations(token);
