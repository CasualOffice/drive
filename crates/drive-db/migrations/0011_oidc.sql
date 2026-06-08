-- Phase 3 §12 — OIDC sign-in.
-- Spec: docs/research/12-oidc.md.
--
-- Additive: existing local-password rows keep working. A user can have
-- both auth paths on the same row (set by the operator after first OIDC
-- sign-in). The unique index covers the case where the same email signs
-- in under two different configured IdPs in v0.4 multi-IdP work — for
-- v0.3 there's only one provider at a time so the index is functionally
-- a unique-on-subject.

ALTER TABLE users ADD COLUMN oidc_provider_id TEXT;
ALTER TABLE users ADD COLUMN oidc_subject TEXT;
ALTER TABLE users ADD COLUMN oidc_email_verified INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX users_oidc_subject_idx
  ON users(oidc_provider_id, oidc_subject)
  WHERE oidc_subject IS NOT NULL;

-- Per-flow short-lived state. We could keep this in-memory (lose state
-- across restarts) but SQL is simpler + survives the worker process
-- restart that would otherwise strand active sign-in attempts.
CREATE TABLE oidc_flow_state (
  state          TEXT PRIMARY KEY,
  pkce_verifier  TEXT NOT NULL,
  nonce          TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  expires_at     TEXT NOT NULL
);
CREATE INDEX oidc_flow_state_expires_idx ON oidc_flow_state(expires_at);
