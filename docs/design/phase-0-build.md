# Phase 0 — Build Spec

The implementation-level target for Phase 0. Code is written **against this doc**; nothing here is optional or aspirational. Read with [`../ARCHITECTURE.md`](../ARCHITECTURE.md), [`../../PLAN.md`](../../PLAN.md) (Phase 0), and [`../TESTING.md`](../TESTING.md) (the invariants this spec must satisfy).

**Phase 0 goal:** turn the inherited Casual Drive codebase into the encrypted, append-only registry *foundation* — no product features, no UI. When Phase 0 is green, documents are encrypted at rest and every save is an immutable, hash-chained, verifiable version.

**Non-goals (Phase 0):** search, AI, editor UI, retention/legal-hold *UI*, key-rotation UX, co-editing. Seams for these are added; behaviour is not.

---

## 1. Crate rename & narrow

Mechanical, test-guarded. One PR, no behaviour change beyond deletions.

| Current | Target | Action |
|---|---|---|
| `drive-core` | `dochub-core` | rename |
| `drive-db` | `dochub-db` | rename |
| `drive-storage` | `dochub-storage` | rename (encryption layer added in §4) |
| `drive-auth` | `dochub-auth` | rename |
| `drive-http` | `dochub-http` | rename |
| `drive-bin` | `dochub-bin` | rename |
| `drive-wopi` | `dochub-wopi` | rename + **demote** (§7) |
| `drive-thumb-worker` | — | **delete** (docs-only; no thumbnails) |
| — | `dochub-crypto` | **new** (§3) |
| — | `dochub-index` | new **crate stub only** (Phase 3 fills it) |

- Env: `DRIVE_*` → `DOCHUB_*` (see §9). Session cookie `__Host-cd_sid` → `__Host-dh_sid`.
- Delete thumbnail code paths and the `files.thumbnail` / `files.thumbs_state` columns (migration). Remove media/preview handling for non-document types.
- **Acceptance:** workspace builds; existing tests pass under new names; `grep -r "drive[-_]"` finds only deliberate heritage strings.

## 2. Documents-only ingest allowlist

The gate that makes encryption + indexing tractable.

- **Allowlist (authoritative):** `docx, xlsx, xlsm, pptx, pdf, md, txt, csv, json, yaml` (+ `yml`). `xlsm`/`pptx` accepted but treated as opaque (not editor-opened).
- **Enforcement:** on **every** ingest path — proxy multipart upload **and** any direct-to-storage finalize — by **(a) extension** and **(b) magic-byte sniff** (`infer` crate + explicit checks for the text formats). Mismatch or unknown → **reject `415`**, never quarantine.
- Location: a single `dochub_core::ingest::guard(name, head_bytes) -> Result<DocKind, IngestError>` used by all handlers. One allowlist constant; no per-handler copies.
- **Tests:** table test over allowed + a rejection corpus (`.mp4`, `.exe`, `.zip`, renamed `.docx`→`.png`, empty, oversize). Invariant TESTING.md #8.

## 3. `dochub-crypto` — envelope encryption

No homebrew primitives. Crate wraps `aws-lc-rs` (AES-256-GCM, SHA-256) — audited, FIPS-friendly.

### Key hierarchy
```
master KEK   (DOCHUB_MASTER_KEY or KMS)        — never persisted
   └─ wraps ─▶ per-workspace DEK               — persisted only wrapped
                 └─ encrypts ─▶ document blobs
```

### Blob format
`nonce(12) ‖ ciphertext ‖ tag(16)`, random 96-bit nonce per blob. Versioned by a 1-byte prefix (`0x01`) for future algorithm agility.

### API (`dochub-crypto`)
```rust
pub struct SealedBlob(Vec<u8>);            // 0x01 ‖ nonce ‖ ct ‖ tag
pub struct Dek([u8; 32]);                  // zeroized on drop
pub struct WrappedDek { ct: Vec<u8>, key_version: u32 }

pub trait KeyProvider {                    // master KEK source; KMS seam
    fn wrap(&self, dek: &Dek) -> Result<WrappedDek>;
    fn unwrap(&self, w: &WrappedDek) -> Result<Dek>;
    fn key_version(&self) -> u32;
}
pub struct EnvKek(/* from DOCHUB_MASTER_KEY */);   // Phase 0 default
// pub struct KmsKek(...)                           // seam; wired later

pub fn generate_dek() -> Dek;
pub fn seal(dek: &Dek, plaintext: &[u8]) -> SealedBlob;
pub fn open(dek: &Dek, blob: &[u8]) -> Result<Vec<u8>, CryptoError>;
```

### Key storage (`dochub-db`, migration)
```sql
CREATE TABLE workspace_keys (
  workspace_id   TEXT PRIMARY KEY REFERENCES workspaces(id),
  wrapped_dek    TEXT NOT NULL,   -- base64(WrappedDek ciphertext)
  key_version    INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL
);
```
On first write to a workspace, generate + wrap + persist its DEK. `Dek` lives only in memory, zeroized on drop. Keys never logged, never in errors, never in responses.

### Boot invariant
`dochub-bin` **refuses to start** if no `DOCHUB_MASTER_KEY` and no KMS configured (see §8).

- **Tests:** known-answer vectors in `dochub-crypto/tests/vectors/`; `proptest` round-trip `open(seal(x))==x` ∀x; wrap/unwrap round-trip; tampered blob → `CryptoError` (never panic). Invariants TESTING.md #1, #7-seam.

## 4. Encrypted storage facade

`dochub-storage` keeps the OpenDAL facade and adds a **mandatory** crypto layer.

```rust
impl Storage {
  async fn put_blob(&self, ws: &Workspace, plaintext: &[u8]) -> Result<StorageKey>;
  async fn get_blob(&self, ws: &Workspace, key: &StorageKey) -> Result<Vec<u8>>;
}
// put_blob: dek = keys.dek(ws); ct = seal(dek, plaintext); operator.write(key, ct)
// get_blob: ct = operator.read(key); open(dek, ct)
```

- **No plaintext at rest.** Handlers cannot reach `opendal::Operator`; only `put_blob`/`get_blob`. Enforced by module privacy **and** by a spy backend in tests.
- **Content-addressed, write-once.** Version blob key = `versions/{content_hash}` where `content_hash = SHA-256(ciphertext)`. Writing an existing key is a no-op (dedup); never overwritten.
- BYO-bucket credential sealing (existing) migrates to `dochub-crypto`'s scheme.
- **Tests:** spy backend asserts bytes written are ciphertext (invariant #1); write-once idempotence; four-backend conformance (fs/mem/S3/MinIO).

## 5. Version + hash-chain engine (the registry core)

### Schema (`dochub-db`, migration)
```sql
CREATE TABLE file_versions (
  file_id       TEXT NOT NULL REFERENCES files(id),
  seq           INTEGER NOT NULL,          -- 1-based, monotone per file
  storage_key   TEXT NOT NULL,             -- versions/{content_hash}
  size          INTEGER NOT NULL,
  content_hash  TEXT NOT NULL,             -- SHA-256(ciphertext), hex
  prev_hash     TEXT,                      -- previous version's content_hash; NULL at seq=1
  author_id     TEXT NOT NULL REFERENCES users(id),
  reason        TEXT,                      -- e.g. "edit", "restore of v3", "import"
  created_at    TEXT NOT NULL,
  PRIMARY KEY (file_id, seq)
);
CREATE INDEX file_versions_file_idx ON file_versions(file_id, seq DESC);
CREATE INDEX file_versions_hash_idx ON file_versions(content_hash);
```
- `files.version` (the old counter) becomes the **head pointer** = `MAX(seq)`. Remove overwrite-in-place update paths.
- **Migration:** for every existing non-trashed file, encrypt its current bytes and backfill `file_versions` seq=1 (`prev_hash=NULL`). Existing plaintext blobs are re-sealed.

### API (`dochub-db` + a `dochub-core::registry` service)
```rust
// Append a new version. THE ONLY write path for document bytes.
async fn commit_version(file_id, plaintext, author_id, reason) -> Version;
//   guard(plaintext) → key=put_blob(seal) → content_hash → prev=head.content_hash
//   → insert (seq=head.seq+1, prev_hash=prev) → bump files head → enqueue reindex (Phase 3 no-op)

async fn verify_chain(file_id) -> ChainStatus;   // Intact | Broken { at_seq }
//   recompute SHA-256(get ciphertext) per seq; check link prev_hash==versions[seq-1].content_hash

async fn restore_version(file_id, seq, author_id) -> Version;   // = commit_version(bytes_of(seq), "restore of v{seq}")
```
- **Append-only.** No API updates or deletes a committed `file_versions` row. "Delete a file" = tombstone (`files.tombstoned_at`), obeying retention/legal-hold (columns added now, enforcement Phase 1); blobs under hold are never removed.
- **Tests:** N edits → N chained versions; corrupt any stored version → `verify_chain` = Broken at that seq (proptest over a tamper corpus); restore is additive (invariants TESTING.md #3, #4, #5). e2e UC-3/UC-4.

## 6. Audit hash-chaining

Extend the existing append-only `audit_log`.
```sql
ALTER TABLE audit_log ADD COLUMN prev_hash  TEXT;   -- previous row's entry_hash
ALTER TABLE audit_log ADD COLUMN entry_hash TEXT;   -- SHA-256(canonical(row) ‖ prev_hash)
```
- Single append helper computes `entry_hash` over a canonical serialization of the event + `prev_hash` (global chain, or per-workspace chain — **decision D1 below**).
- `verify_audit_chain(scope)` recomputes end-to-end. Committed rows never `UPDATE`/`DELETE`.
- Add Phase-0 actions to the vocabulary: `version.commit`, `version.restore`, `file.tombstone`, `ingest.reject`, `key.workspace_created`, `boot.invariant_failed`.
- **Tests:** appends chain; tampered row fails verification (invariant #4, extended to audit).

## 7. WOPI demotion

- Gate the WOPI host behind `DOCHUB_WOPI_ENABLED` (**default `false`**). Off = endpoints return `404`.
- Add the **primary** editing seam (stub, no editor yet): `GET /api/documents/{id}/editor` mints an editor access token `(user_id, file_id, perms, exp, jti)` (HMAC); `GET/PUT /api/documents/{id}/content` decrypt-stream / seal-and-`commit_version`. Phase 2 mounts the real editors on these.
- Keep WOPI lock/token code intact behind the flag for future external-Office interop.
- **Tests:** token separation (share-link token ≠ editor token; url file-id must match claim) — invariant #10. WOPI disabled by default.

## 8. Boot invariants (`dochub-bin`, fail-fast)

Refuse to start unless **all** hold (each covered by a test):
1. A master key is configured (`DOCHUB_MASTER_KEY` present and ≥32 bytes, **or** a KMS provider configured).
2. In production, `app_origin != usercontent_origin`.
3. DB migrations apply cleanly.
4. The configured storage backend is reachable (probe read/write of a temp key).

## 9. Config surface (Phase 0 `DOCHUB_*`)

| Var | Meaning |
|---|---|
| `DOCHUB_BIND` | listen addr |
| `DOCHUB_APP_ORIGIN` / `DOCHUB_USERCONTENT_ORIGIN` | two-origin model |
| `DOCHUB_DB_URL` | sqlite/postgres |
| `DOCHUB_STORAGE_BACKEND` / `DOCHUB_FS_ROOT` / S3 vars | OpenDAL backend |
| `DOCHUB_MASTER_KEY` | base64 32-byte KEK (**boot-required**) |
| `DOCHUB_KMS_*` | optional KMS provider (seam) |
| `DOCHUB_SESSION_SECRET` / `DOCHUB_*_HMAC_SECRET` | session + token HMACs |
| `DOCHUB_WOPI_ENABLED` | default `false` |
| `DOCHUB_ADMIN_USER` / `DOCHUB_ADMIN_PASSWORD_HASH` | first-run admin |

## 10. Test matrix (maps to `docs/TESTING.md`)

| Invariant / UC | Where |
|---|---|
| #1 no plaintext at rest | `dochub-storage` spy-backend integration + crypto proptest |
| #2 boot refuses without key | `dochub-bin` integration |
| #3 append-only history | `dochub-db` registry integration |
| #4 chain integrity detectable | `dochub-crypto`/registry proptest (tamper corpus) + audit |
| #5 restore additive | registry integration + e2e UC-4 |
| #7 key rotation lossless (seam) | crypto unit (wrap/unwrap under version bump) |
| #8 ingest allowlist | `dochub-core::ingest` table test (both paths) |
| #9 origin isolation | `dochub-http` boot + middleware tests |
| #10 token separation | `dochub-auth` / editor-token tests |

Coverage gate ≥85% workspace-wide; `dochub-crypto` + registry target 100% branch.

## 11. PR sequence (each green before the next)

1. **P0.1** Rename & narrow (§1) + delete thumbnails.
2. **P0.2** `dochub-crypto` + `workspace_keys` + boot key invariant (§3, §8).
3. **P0.3** Encrypted storage facade + no-plaintext test (§4).
4. **P0.4** `file_versions` + `commit_version`/`verify_chain`/`restore` + backfill migration (§5).
5. **P0.5** Audit hash-chaining (§6).
6. **P0.6** Ingest allowlist (§2) + WOPI demotion + editor seam (§7).

Phase 0 **done** when the §10 matrix is green and the PLAN.md Phase 0 acceptance list passes.

## 12. Decisions needed before P0.5

- **D1 — Audit chain scope:** one global chain vs. per-workspace chains. *Recommendation:* per-workspace (isolates tenants; simpler export per project). Confirm before §6.
- **D2 — Crypto backend:** `aws-lc-rs` vs `ring`. *Recommendation:* `aws-lc-rs` (maintained, FIPS path). Confirm before §3.
- **D3 — Master-key rotation UX:** deferred to Phase 1; Phase 0 only stores `key_version`. Confirm the seam is sufficient.
