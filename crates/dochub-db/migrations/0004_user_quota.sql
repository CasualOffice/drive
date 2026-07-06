-- Per-user storage quota (pipeline §6.4). NULL = unlimited (the default
-- for the v0 single-tenant admin). Set to a byte count to enforce.
ALTER TABLE users ADD COLUMN quota_bytes INTEGER;
