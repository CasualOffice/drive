# Architecture

How Doc-Hub fits together: the crate workspace, the encrypted storage facade, the immutable version + hash-chain engine, the two-origin security model, the token model, embedded editing, content indexing, and the AI layer. Distillation of [`research/00-synthesis.md`](./research/00-synthesis.md); deeper rationale lives in the numbered briefs.

> Doc-Hub is the revamp of Casual Drive from a storage Drive into a document registry. Names in flight: `drive-*`→`dochub-*`, `DRIVE_*`→`DOCHUB_*`.

## One-paragraph model

A user signs in to a project, uploads or creates a document, and edits it in an embedded native editor. On save, the bytes are encrypted, written write-once to a storage backend, and appended as a new hash-chained version; an audit event is appended; a background worker extracts text and updates the full-text index. Nothing is ever overwritten or erased — history is a verifiable chain. Search reads document *content*; an optional AI layer reasons over it. The server holds keys (encryption defends storage-at-rest, not a compromised server), which is the deliberate trade that makes content search and AI possible.

## Crate workspace

```
dochub-core     Domain types, Config, error taxonomy. No I/O.
dochub-db       SQLx repos + migrations. SQLite + Postgres portable.
dochub-crypto   Envelope encryption, key wrap/rotate, hash chains, provenance signing.
dochub-storage  OpenDAL facade + mandatory encryption layer + BYO-bucket sealing.
dochub-index    core-backed extraction → Tantivy full-text index (background worker).
dochub-ai       Optional LLM layer: semantic search, summaries, PII, Q&A.
dochub-auth     Sessions, Argon2id, OIDC, share links.
dochub-http     Axum router, two-origin middleware, every API + editor byte stream.
dochub-bin      Binary entry point; boot-time invariant checks.
```

Dependency direction is strictly downward: `http` → {`auth`, `storage`, `index`, `ai`, `db`, `crypto`} → `core`. `core` (the pure-Rust document engine, shared with the desktop suite) is a vendored dependency, not re-implemented here.

## Encrypted storage facade

All document bytes pass through `Arc<Storage>`. The facade wraps an `opendal::Operator` with a mandatory encryption layer:

```
write(key, plaintext)  →  dochub-crypto.seal(workspace_dek, plaintext)  →  operator.write(key, ciphertext)
read(key)              →  operator.read(key) → dochub-crypto.open(workspace_dek, ciphertext) → plaintext
```

- **Envelope encryption.** Each workspace has a Data Encryption Key (DEK). The DEK is wrapped by a master Key Encryption Key (KEK) supplied via `DOCHUB_MASTER_KEY` or an external KMS; only wrapped DEKs are persisted. Primitive: AES-256-GCM (`ring`/`aws-lc-rs`), random 96-bit nonce per blob, stored as `nonce ‖ ciphertext ‖ tag`.
- **No plaintext at rest.** No code path writes plaintext document bytes to a backend. Enforced by construction (handlers cannot reach the raw operator) and by test (a spy backend asserts ciphertext).
- **Key rotation** re-wraps DEKs under a new KEK without rewriting document blobs. Blobs are re-encrypted only on explicit workspace re-key. Rotate the master KEK by setting `DOCHUB_MASTER_KEY_NEXT` (base64, 32 bytes) alongside the current `DOCHUB_MASTER_KEY`, then running the admin subcommand `dochub rotate-kek`: it unwraps each `workspace_keys` row under the current KEK, re-wraps the same plaintext DEK under the next KEK, and bumps `key_version` — an admin/CLI action only, never an HTTP endpoint. The command prints a per-workspace report (`rotated`, `failed`); a workspace that fails to unwrap under the current KEK is reported, not fatal. On a clean run, promote `DOCHUB_MASTER_KEY_NEXT` to `DOCHUB_MASTER_KEY` and unset the next key.
  - **Zero-downtime while both keys are configured.** When `DOCHUB_MASTER_KEY_NEXT` is set, the running server's DEK resolver (`WorkspaceDeks`) unwraps by trying the current KEK, then the next one as a fallback (`with_next_kek`). So a row already re-wrapped by `rotate-kek` reads on a server that hasn't promoted the key yet, and — if the operator keeps the *old* key configured as `DOCHUB_MASTER_KEY_NEXT` after promotion (a grace window) — a straggler still under the old key keeps reading too. A wrong key fails GCM authentication cleanly, so the fallback can't false-positive. New DEKs are always sealed under the current KEK. The safe flow is therefore: (1) set `NEXT` alongside `CURRENT`, restart; (2) run `rotate-kek` until the report is clean; (3) promote `NEXT`→`CURRENT`, optionally keep the old key as `NEXT` for a grace window, restart; (4) once confident, unset `NEXT`. Reads never 500 on a mixed set of rows at any step.
- **Backends:** fs / memory / S3 / MinIO / R2 / B2 via OpenDAL. Storage keys are opaque ULIDs, never derived from user input. BYO-bucket credentials are themselves sealed with the same envelope scheme.

## Immutable version + hash-chain engine

The heart of the registry.

```
file_versions(file_id, seq, storage_key, size, content_hash, prev_hash, author_id, reason, created_at)
```

- On every committed save, a **new** version row is appended: `content_hash = SHA-256(ciphertext)`, `prev_hash = ` the previous version's `content_hash`. `seq` increments; the head is the file's current version.
- **Write-once.** Version blobs are content-addressed and never overwritten. "Delete" writes a tombstone and obeys retention + legal hold; bytes under hold are never removed.
- **Verification.** `verify_chain(file_id)` recomputes hashes and links end-to-end. A mismatch is a tamper alarm — surfaced to admins and audited, never silently repaired.
- **Restore** version *k* appends a new version *N+1* whose bytes equal *k*. The old chain is preserved; restore is additive.
- **Audit chain.** The append-only `audit_log` is hash-chained the same way; committed rows are never updated or deleted. Admins download the whole chain as a self-verifiable report via `GET /api/admin/audit/export` (every row + both hash columns + the server's verdict); a recipient re-checks it **offline** with `dochub verify-audit <file>` — recomputing each `entry_hash` and re-walking the linkage with no database. The export is itself audited (`audit.export`). Optional: periodic Ed25519-signed anchoring of chain heads for third-party-verifiable provenance (transparency-log-lite).

## Two-origin security model

- **App origin** (`hub.<host>`): SPA, JSON API, editor byte streams. Strict CSP. Session cookies live here only.
- **User-content origin** (`usercontent-dochub.<host>`): serves `/raw/{token}` for share-links and isolated content. `CSP: sandbox; default-src 'none'`, no cookies, `Content-Disposition: attachment` for non-previewable types.
- Boot **refuses to start in production** if the two origins are equal. Neither CSP is weakened; `/raw/{token}` never moves to the app origin.

## Token model

| Token | Purpose | Lifetime |
|---|---|---|
| Session cookie (`__Host-`) | Browser session | server-side store |
| Editor access token | per-launch, per-document editor auth `(user_id, file_id, perms, exp, jti)`, HMAC | short TTL |
| Share-link token | one per share row, constant-time compared | until expiry/revoke |
| Signed-URL token | fs/mem `/raw/{token}`, HMAC over `(key, exp, method)` | short TTL |
| API token (PAT) | headless-agent bearer for `/api/mcp` (`Authorization: Bearer dh_pat_…`); minted at `/api/tokens`, SHA-256 hashed at rest, shown once | per-token (optional expiry), revocable |

Never reuse one token for another's job. API tokens are managed session-only
(a PAT can't mint more PATs) and revocation is a tombstone, never a delete.

## Embedded editing

The primary editing path is **embedded**, not WOPI:

```
SPA opens document → app origin mints an editor access token → embedded editor (Sheet/Docs/PDF SDK)
   → server decrypts bytes in memory, streams them over the authenticated app origin
   → user edits (optionally co-edits via the collab server)
   → save → encrypt → append hash-chained version → audit → enqueue reindex
```

One `<Editor>` component hosts each format via its sibling SDK. Team documents co-edit through the `collab` server (Yjs/Hocuspocus), which relays opaque document bytes and never parses them. WOPI remains available as **optional interop** for external Office clients but is not the default path.

## Content indexing

`dochub-index` runs a lazy background worker (mirroring the retired thumbnail-worker pattern): on new version, it calls `core` to extract text (docx/xlsx/pdf/md/txt/csv/json/yaml — PDF via text layer, OCR fallback later), normalizes it, and writes to a Tantivy index. A `files.index_state` column (`pending|ready|unsupported|failed`) drives the worker. Search unions Tantivy content hits with SQL metadata and returns snippets + highlights. Tombstoning a document removes it from the index.

## AI layer (optional)

`dochub-ai` sits beside search, never replacing it for compliance-critical retrieval. Operator guide: [`AI-MCP.md`](./AI-MCP.md).
- **Semantic search + RAG:** embeddings + cosine top-k alongside Tantivy exact/full-text results, feeding a cited answer (`GET /api/search/semantic`, `POST /api/search/ask`). Offline, an extractive answerer stands in — no network, invents nothing.
- **Agentic research:** `POST /api/agent/ask` drives a bounded ReAct loop — the model runs its own permission-scoped searches, refines, then answers with citations + a search trace. Needs a configured provider; reports `available:false` otherwise.
- **MCP:** `POST /api/mcp` (JSON-RPC 2.0) exposes `semantic_search` / `ask` / `research` as tools, authed by session **or** a bearer PAT. Read-only; every tool call is permission-filtered and rate-limited.
- **Summaries:** `dochub_ai::summarize` condenses a document into a few sentences behind a pluggable `Summarizer`; the offline `ExtractiveSummarizer` is deterministic and dependency-free — Luhn-style content-word salience, stopwords removed, top sentences returned **in document order**. Purely extractive: it invents nothing. A hosted abstractive model slots in behind the same trait.
- **PII detection:** `dochub_ai::pii` flags personal data (email, payment card via Luhn, US SSN, IPv4) in extracted text behind a pluggable `PiiDetector`; the offline `PatternPiiDetector` is deterministic, dependency-free, and high-precision. Findings carry a **masked** preview only (never the raw value) plus a byte span, so a scan result is not itself a leak. Surfaced at `POST /api/files/{id}/pii` — session-authed, permission-filtered (view rights), read-only (reads the head through the encrypted version engine), and audited (`pii.scan`). Detection suggests; a human acts.
- **Provider:** pluggable via `DOCHUB_AI_PROVIDER` — Claude (Anthropic Messages API), ChatGPT, or a local OpenAI-compatible server for air-gapped installs. AI never mutates documents or history.

## API error envelope

JSON API endpoints return errors in one stable shape, so a client always gets a parseable body instead of an empty one:

```json
{ "error": { "code": "not_found", "message": "no such token", "retry_after_seconds": 5 } }
```

`code` is a stable machine-readable slug (branch on it); `message` is human detail (don't parse); `retry_after_seconds` appears on `429` only, mirroring the `Retry-After` header. `500`s carry a generic message — the real cause is logged, never leaked. Implemented by `dochub_http::error::ApiError`; adoption is gradual via `From<StatusCode>`. MCP (`/api/mcp`) keeps its JSON-RPC 2.0 error object, as the protocol dictates.

## Data model (portable)

TEXT ULID ids, ISO-8601 UTC timestamps, INTEGER 0/1 bools; no JSONB/enum/native-UUID. Core tables: `users`, `sessions`, `workspaces` (+`workspace_members`, `workspace_invitations`, `workspace_storage`), `folders`, `files` (+`file_versions`), `audit_log`, `share_links`, `retention_policies`, `legal_holds`, `oidc_*`. See `crates/dochub-db/migrations/`.

## Boot invariants (fail-fast)

The binary refuses to start unless: a master key/KMS is configured; the two origins differ (in production); the DB migrates cleanly; storage backend is reachable. These are asserted in `dochub-bin` and covered by tests.

## Health + observability

Unauthenticated app-origin endpoints for orchestration + monitoring:
- `GET /healthz` — **liveness**. Unconditional `200`; the process is up. A transient dependency blip must not fail this (it would trigger a needless restart).
- `GET /readyz` — **readiness**. `200` when both critical dependencies are reachable — the database (`SELECT 1`) and the object store (a read-only sentinel `stat`, never a write) — else `503` with per-dependency status, e.g. `{ "ready": false, "checks": { "db": "ok", "storage": "error" } }`. Orchestrators stop routing to a not-ready instance without killing it.
- `GET /metrics` — **Prometheus** exposition: HTTP responses by status class, in-flight gauge, uptime, and a request-latency histogram (`dochub_http_request_duration_seconds`, 5ms–10s buckets + `_sum`/`_count`) for p95/p99 SLOs. Fed by the access-log middleware, so it reflects real served traffic. Only non-sensitive aggregates; restrict by network policy if needed.

Per-request detail is emitted by the `access_log` middleware (method, redacted path, status, latency, user, workspace, client IP, request id) — `DOCHUB_LOG_FORMAT=json` for a JSON line per request. Shutdown is graceful: on SIGTERM/SIGINT the server drains in-flight requests before exiting.

Day-2 operations — deploy, monitor (with starter PromQL alerts), back up, restore, rotate the master KEK, and respond to a tamper alarm — are in the [operations runbook](./ops/RUNBOOK.md).
