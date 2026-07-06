-- Tamper-evidence for the append-only audit log (build spec §6).
--
-- The audit_log gains a hash chain, exactly like file_versions (§5): each row
-- records the entry_hash of the previous chained row in `prev_hash`, and its
-- own `entry_hash` over a canonical serialization of its stable fields plus
-- that pointer. Verification recomputes end-to-end; the first disagreement is a
-- tamper alarm. Committed rows are never UPDATEd or DELETEd (CLAUDE.md rule 6).
--
-- Scope decision (spec §12 D1): Phase 0 uses a single GLOBAL chain. audit_log
-- has no workspace_id, so a global chain is the simplest correct option;
-- per-workspace chains are a later refinement once the column exists.
--
-- Both columns are nullable so the ALTER is portable (SQLite + Postgres) and so
-- any pre-migration rows keep a NULL entry_hash — those legacy rows sit outside
-- the chain and are skipped by the head read and by verification.

ALTER TABLE audit_log ADD COLUMN prev_hash  TEXT;   -- previous chained row's entry_hash; NULL at the chain head
ALTER TABLE audit_log ADD COLUMN entry_hash TEXT;   -- SHA-256(prev_hex ‖ 0x00 ‖ canonical(row)), lowercase hex
