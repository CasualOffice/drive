-- Fork prevention for the audit hash chain (review finding #14).
--
-- The chain is linear by construction: every non-genesis row's `prev_hash`
-- points at exactly one predecessor's `entry_hash`. Two rows sharing a
-- `prev_hash` is a FORK — the tamper shape an attacker (or a lost concurrent
-- write) produces to splice history. `verify_audit_chain` already DETECTS forks
-- (linkage walk, finding #2); this index PREVENTS them being written at all, so
-- two concurrent appends can't both chain off the same head.
--
-- Partial index (`WHERE prev_hash IS NOT NULL`): the genesis row's prev_hash is
-- NULL, as are pre-0017 legacy rows outside the chain — those must not collide
-- with each other. Partial unique indexes are portable across SQLite + Postgres.
-- On a unique violation the insert path re-reads the head and retries.

CREATE UNIQUE INDEX audit_log_prev_hash_idx
  ON audit_log(prev_hash)
  WHERE prev_hash IS NOT NULL;
