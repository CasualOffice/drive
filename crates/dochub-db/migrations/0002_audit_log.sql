-- Audit log — append-only event feed for everything that mutates state.
-- Backs both the in-app Activity timeline and the compliance export.
-- See docs/ux/06-activity-surface.md.

CREATE TABLE audit_log (
  id              TEXT PRIMARY KEY,
  created_at      TEXT NOT NULL,
  -- Actor: NULL for system events (cron, startup). Username is denormalised
  -- so the display name survives if the user row is later deleted.
  actor_id        TEXT,
  actor_username  TEXT,
  -- Dotted namespaced action. Examples: "auth.sign_in",
  -- "files.upload", "share.create", "share.access".
  action          TEXT NOT NULL,
  -- Target: which object the action acted on. Kind is "file", "folder",
  -- "share_link", "user", "session", "system", or NULL. Both id + name
  -- are denormalised so deleting the target doesn't blank past events.
  target_kind     TEXT,
  target_id       TEXT,
  target_name     TEXT,
  -- Originating IP — optional, only populated for auth events in v0.
  ip_address      TEXT,
  -- Free-form JSON for action-specific metadata (e.g. share token,
  -- file size, old vs new name). Always a JSON object string or NULL.
  metadata        TEXT
);

CREATE INDEX audit_log_created_at_idx ON audit_log(created_at DESC);
CREATE INDEX audit_log_actor_id_idx   ON audit_log(actor_id);
CREATE INDEX audit_log_action_idx     ON audit_log(action);
