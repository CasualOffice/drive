# 08 — Bring-your-own storage per workspace

Pipeline §8.9. Per-workspace S3/MinIO override. Each Team workspace can opt-in to its own bucket + credentials; reads/writes for files in that workspace go through that adapter instead of the server-default. Personal workspaces always use the server default.

## Why

- Cost separation. A team workspace bills its own cloud, not the host's.
- Trust separation. A workspace owner can run their files through storage they audit, even if the host is shared.
- Migration story. A team can `cp` their bucket out, repoint, and walk away. No data lock-in.

## What we're NOT doing

- Per-user storage (only workspaces; users use their Personal workspace's storage = server default).
- Migrating existing files when a workspace flips storage. New files land on the new adapter; the spec calls this out.
- Storing credentials in plaintext. They're encrypted at rest with `DRIVE_STORAGE_SECRET_KEY` (32-byte hex). Boot refuses to start in production if the key is missing.
- Per-user-supplied storage that's reachable from the server's network. Server-side request forgery (SSRF) is the cardinal risk; we validate the endpoint scheme + hostname before any test request.

## Threat model

| Risk | Mitigation |
|---|---|
| **Plaintext creds at rest** | AES-256-GCM with a server-wide key. Per-row nonce. Ciphertext + nonce + tag stored together. |
| **SSRF via test-connection** | Endpoint must be `https://` (with `http://` allowed only when host is `localhost`/`127.0.0.1`/private RFC1918 *and* `DRIVE_ALLOW_INSECURE_BYO=true`). Hostname resolution checked against block list. |
| **Credential exfiltration via API** | `GET /api/workspaces/{id}/storage` returns provider + bucket + endpoint + region. **Never** returns the secret access key. UI shows `••••••••` + a "Replace credentials" action that requires re-entry. |
| **Privilege escalation: Member sets storage** | Only Owner can configure. Backend rechecks role. |
| **Default-storage leak after switch** | When a workspace activates BYO storage, new files land on BYO. Existing files keep their `storage_id` pointer to the server default. `files.storage_id` (NEW column) → `workspace_storage` row or NULL = server default. |
| **Stale adapter cache** | Adapter is keyed by `(workspace_id, storage_id, key_version)`. Rotating creds bumps `key_version` so cached adapters get invalidated. |

## Schema

```sql
-- 0007_workspace_storage.sql
CREATE TABLE workspace_storage (
  id              TEXT PRIMARY KEY,         -- ULID
  workspace_id    TEXT NOT NULL UNIQUE,     -- 1 BYO config per workspace (v0; multi-target deferred)
  provider        TEXT NOT NULL,            -- 's3' | 'minio' | 'r2' | 'b2'
  bucket          TEXT NOT NULL,
  region          TEXT NOT NULL,
  endpoint        TEXT,                     -- NULL = AWS default
  access_key_id   TEXT NOT NULL,
  -- Secret stored as base64(nonce || ciphertext || tag) — never plaintext.
  secret_ct       TEXT NOT NULL,
  -- Bumps on every credential edit so cached adapters invalidate.
  key_version     INTEGER NOT NULL DEFAULT 1,
  -- Set after a successful test_connection() call; powers a UI badge.
  tested_at       TEXT,
  tested_ok       INTEGER NOT NULL DEFAULT 0,
  tested_error    TEXT,
  created_at      TEXT NOT NULL,
  modified_at     TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

CREATE INDEX workspace_storage_workspace_id_idx
  ON workspace_storage(workspace_id);

-- files.storage_id: NULL → server default; otherwise → workspace_storage.id
ALTER TABLE files ADD COLUMN storage_id TEXT;
CREATE INDEX files_storage_id_idx ON files(storage_id);
```

## Crypto envelope

- KDF: none — we use the configured master key directly. Master key is 32 bytes; if you don't have one yet, generate with `openssl rand -hex 32`.
- Cipher: AES-256-GCM via `aes-gcm` crate (RustCrypto). Already-audited, no homebrew.
- Per-row nonce: 12 random bytes from `OsRng`.
- AAD: `workspace_storage.id || ":" || key_version` so a ciphertext can't be swapped between rows.
- On disk: `BASE64(nonce || ciphertext || tag)`. Tag is 16 bytes.
- Rotation: replacing creds = `key_version += 1` + new ciphertext. Old caches drop on the version mismatch.

## Storage facade changes

The facade gains a workspace-aware constructor + an adapter cache:

```rust
// drive-storage/src/lib.rs
pub struct StorageRegistry {
    default: Arc<Storage>,
    // Caches per (workspace_id, key_version). Bounded — evict on insert past N.
    cache: dashmap::DashMap<CacheKey, Arc<Storage>>,
    master_key: [u8; 32],
}

impl StorageRegistry {
    /// Returns the adapter that should serve a given workspace.
    /// Falls back to default when no BYO config is set.
    pub async fn for_workspace(
        &self,
        db: &Db,
        workspace_id: &str,
    ) -> Result<Arc<Storage>, StorageError> { /* ... */ }

    /// Returns the adapter that should serve a given file row, honouring
    /// the per-file storage_id pointer.
    pub async fn for_file(
        &self,
        db: &Db,
        file: &File,
    ) -> Result<Arc<Storage>, StorageError> { /* ... */ }
}
```

Every handler that touches bytes (`upload_file`, `download_file`, `/raw/{token}`, WOPI `GetFile`/`PutFile`) goes through `registry.for_file(&db, &file)` instead of holding a single `Arc<Storage>` directly. The HTTP state changes from `Arc<Storage>` to `Arc<StorageRegistry>`.

`files.storage_id` is set at upload time from `registry.for_workspace(...)` — if the workspace has BYO active, the new file pins to it. The pointer is permanent for that row; switching storage later doesn't migrate prior rows.

## Test-connection endpoint

```
POST /api/workspaces/{id}/storage/test
Body: { provider, bucket, region, endpoint?, access_key_id, secret_access_key }
```

Server:
1. Owner-only.
2. Validate provider + URL shape + SSRF block list.
3. Build a one-shot adapter (not cached).
4. Attempt `stat()` on a random temp key, then `put()` a 1-byte object, then `delete()` it.
5. Return `{ ok: true, latency_ms }` or `{ ok: false, error: "..." }`.

Test-connection never persists. It's a dry-run. Saving config is a separate `PUT` that runs test internally first and stores `tested_*` columns.

## Audit

| Action | Metadata |
|---|---|
| `workspace_storage.configured` | provider, bucket, region, endpoint? |
| `workspace_storage.replaced_credentials` | provider, key_version |
| `workspace_storage.removed` | (returns workspace to server default for NEW files) |
| `workspace_storage.test_run` | ok, latency_ms, error? |

Audit metadata never includes the secret access key. Test-connection bodies are scrubbed in logs (per CLAUDE.md security checklist).

## Out of scope (v0.2+)

- Per-workspace KMS integration (AWS KMS, GCP KMS). v0 uses the host-wide master key.
- Migrating existing files when BYO flips. Manual `mc mirror` is the v0 answer.
- Multi-target (one workspace, multiple buckets). v0 is 1-to-1.
- Backblaze B2 + R2 specific tuning. Provider field accepts them but uses S3 client path.
- Per-user-supplied storage. Personal workspaces always = server default.
