# Phase 1 — Build Spec

Implementation-level target for **Phase 1 — Encrypted hub + immutable history, end to end**. Code is written against this doc. Read with [`phase-0-build.md`](./phase-0-build.md), [`../ARCHITECTURE.md`](../ARCHITECTURE.md), [`../../PLAN.md`](../../PLAN.md) (Phase 1), and [`../TESTING.md`](../TESTING.md).

**Phase 1 goal:** make the encrypted, versioned registry *operable and provable* — keys rotate without data loss, history is browsable/restorable/verifiable through the API, provenance is exportable, and retention + legal hold are enforced. Still no product UI (that is the parallel `web/` track); this is the API + engine layer the version-history and compliance surfaces bind to.

**Depends on Phase 0** (all merged): `dochub-crypto` (`seal`/`open`/`EnvKek`/`chain`), encrypted storage facade, `workspace_keys`/`WorkspaceDeks`, `Registry` (`commit_version`/`verify_chain`/`restore_version`), audit hash-chaining. Migrations are at `0017`; Phase 1 continues from `0018`.

**Non-goals (Phase 1):** UI, search/AI, multi-IdP, per-workspace audit chain (still global). Provenance signing is included as the compliance anchor; full registrar/issuer flows are Phase 4.

---

## 1. Key management (`dochub-crypto` + `dochub-db` + `dochub-bin`)

### 1.1 KMS provider
- `KmsKek` implements the existing `KeyProvider` trait (wrap/unwrap/key_version) against an external KMS. Config: `DOCHUB_KMS_PROVIDER` (`env` | `aws-kms` | ...), `DOCHUB_KMS_KEY_ID`, provider creds. `EnvKek` stays the default; selection happens in `Config::from_env`. No global keys; the provider is injected as today.
- Boot invariant unchanged: refuse to start without a configured provider (Phase 0 §8).

### 1.2 DEK re-wrap (KEK rotation) — no blob rewrite
Rotating the master KEK must NOT re-encrypt document blobs (they're sealed under per-workspace DEKs). Only the *wrapped DEKs* are re-sealed under the new KEK.

```rust
// dochub-db
async fn rewrap_workspace_dek(ws: &WorkspaceId, old: &dyn KeyProvider, new: &dyn KeyProvider) -> Result<()>;
//   dek = old.unwrap(row.wrapped_dek); new_wrapped = new.wrap(dek); UPDATE workspace_keys SET wrapped_dek, key_version = new.key_version()
async fn rewrap_all(old, new) -> RotationReport;   // iterate workspaces; report {rotated, failed}
```
- `workspace_keys.key_version` bumps on re-wrap. Blobs untouched → every document still decrypts.
- CLI/admin entrypoint: `dochub rotate-kek` (behind admin auth) — reads `DOCHUB_MASTER_KEY_NEXT` / KMS new key id, re-wraps all, atomic per workspace.

### 1.3 Workspace DEK rotation (optional, blob-rewriting) — deferred stub
Full DEK rotation (new DEK + re-seal every blob) is heavier; expose the seam (`RegistryError::ReKeyNotImplemented`) and defer to Phase 4. Phase 1 ships KEK re-wrap only.

**Acceptance:** after `rewrap_all` under a new KEK, every existing document reads back byte-identical (integration test with two KEKs). Invariant TESTING.md #7.

## 2. Version-history + provenance API (`dochub-http` + `dochub-db` + `dochub-crypto`)

Endpoints (app origin, authenticated, permission-checked):

| Method · Path | Purpose |
|---|---|
| `GET /api/files/{id}/versions` | list the chain: `[{seq, size, content_hash, prev_hash, author, reason, created_at}]`, head first |
| `GET /api/files/{id}/versions/{seq}/content` | decrypted bytes of a specific version (perm-gated) |
| `POST /api/files/{id}/restore/{seq}` | `restore_version` → new head (additive); audited `version.restore` |
| `GET /api/files/{id}/verify` | `verify_chain` → `{status: intact}` or `{status: broken, at_seq}` |
| `GET /api/files/{id}/diff?from={a}&to={b}` | extracted-text diff between two versions (text formats via `core`; structured for sheets — best-effort; opaque → "binary changed") |
| `GET /api/files/{id}/provenance` | signed provenance manifest (below) |

### 2.1 Provenance manifest (Ed25519)
- Server holds a workspace (or instance) Ed25519 signing key (new `provenance_keys` table; private key wrapped by the master KEK like DEKs).
- Manifest = `{file_id, chain: [{seq, content_hash, prev_hash, created_at, author}], head, generated_at}` + `signature` over a canonical serialization.
- `GET .../provenance` returns the manifest + public key; a recipient verifies the signature **and** re-walks the hash chain offline. Add a `dochub verify-provenance <file.json>` CLI for offline verification.
- `dochub-crypto`: `sign(key, bytes) -> Sig`, `verify(pubkey, bytes, sig)` (ed25519-dalek).

**Acceptance:** `versions` lists the full chain; `restore` is additive + audited; `verify` detects a tampered blob; an exported provenance manifest verifies offline against the chain and fails if any `content_hash` is altered. e2e UC-3/UC-4/UC-9.

## 3. Retention + legal hold (`dochub-db` + `dochub-http`)

### 3.1 Schema (migrations `0018`, `0019`)
```sql
-- 0018_retention.sql
CREATE TABLE retention_policies (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id),
  scope         TEXT NOT NULL,             -- 'workspace' (Phase 1); 'project'/'tag' later
  min_versions  INTEGER,                   -- keep at least N versions (NULL = all)
  min_age_days  INTEGER,                   -- keep for at least N days (NULL = forever)
  mode          TEXT NOT NULL DEFAULT 'retain', -- 'retain' only in P1 (no auto-purge)
  created_at    TEXT NOT NULL
);
-- 0019_legal_holds.sql
CREATE TABLE legal_holds (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id),
  target_kind   TEXT NOT NULL,             -- 'file' | 'project' | 'workspace'
  target_id     TEXT,                      -- NULL for workspace-wide
  reason        TEXT NOT NULL,
  placed_by     TEXT NOT NULL REFERENCES users(id),
  placed_at     TEXT NOT NULL,
  released_at   TEXT                       -- NULL = active
);
```
Also add `files.tombstoned_at TEXT` (tombstone, not delete) if not already present.

### 3.2 Enforcement (the point of Phase 1 compliance)
- **Delete = tombstone.** The existing file-delete path sets `tombstoned_at`; it never removes `file_versions` rows or blobs.
- A **guard** consulted by every destructive path (`tombstone`, any future purge): a file/project under an **active legal hold** cannot be tombstoned or purged → `409 UnderLegalHold`. Retention `min_age`/`min_versions` block purge of covered versions.
- Hold/retention actions are audited (`hold.placed`, `hold.released`, `retention.set`).
- Admin endpoints: `POST/DELETE /api/holds`, `POST /api/retention` (admin/owner only).

**Acceptance:** a file under legal hold rejects tombstone/purge from every path (test); releasing the hold re-permits it; retention blocks purge of in-window versions. Invariant TESTING.md #6.

## 4. Test matrix (maps to `docs/TESTING.md`)

| Invariant / UC | Where |
|---|---|
| #6 retention & legal hold hold | `dochub-db`/`http` integration (every destructive path) + e2e UC-8 |
| #7 key rotation lossless | `dochub-crypto`/`db` two-KEK integration |
| #3/#4/#5 history append-only / verify / restore (via API) | `dochub-http` version endpoints + e2e UC-3/4 |
| #9 provenance verifies offline | `dochub-crypto` sign/verify + a manifest round-trip + CLI |

`fmt --check` · `clippy --all-features -Dwarnings` · `test --all-features` green; coverage ≥85%; crypto/hold paths 100% branch.

## 5. PR sequence (each green before the next; target `main` directly, not stacked)

1. **P1.1** KMS provider seam + KEK re-wrap (`rewrap_all`) + `dochub rotate-kek` + lossless test.
2. **P1.2** Retention + legal-hold schema (`0018`/`0019`) + enforcement guard on the tombstone/purge paths + admin endpoints.
3. **P1.3** Version-history API (`versions`/`versions/{seq}/content`/`restore`/`verify`).
4. **P1.4** Provenance signing (`provenance_keys`, Ed25519, manifest endpoint + offline `verify-provenance` CLI).
5. **P1.5** Diff endpoint (`core`-backed text/structured diff).

Phase 1 **done** when the §4 matrix is green and the PLAN.md Phase 1 acceptance list passes. These endpoints are what the `web/` version-history + compliance surfaces bind to.

## 6. Decisions needed

- **D1 — Provenance key scope:** per-workspace vs per-instance signing key. *Recommendation:* per-workspace (tenant isolation; matches DEK model).
- **D2 — Retention auto-purge:** Phase 1 is `retain`-only (no automated deletion). Confirm auto-purge stays Phase 4 (needs careful legal-hold interplay).
- **D3 — KEK rotation trigger:** CLI/admin action vs scheduled. *Recommendation:* explicit admin action in Phase 1.
