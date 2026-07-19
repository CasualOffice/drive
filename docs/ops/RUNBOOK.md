# Operations runbook

Day-2 operations for a self-hosted Doc-Hub. Deep architecture lives in
[`../ARCHITECTURE.md`](../ARCHITECTURE.md); the container quick-start lives in
[`../../.docker/README.md`](../../.docker/README.md). This page is the
operator's checklist: deploy, monitor, back up, restore, rotate keys, and
respond to a tamper alarm.

Every command, environment variable, and endpoint named here maps to code in
this repo — nothing aspirational.

## Boot-time invariants

The process **refuses to start** (non-zero exit, clear error) when:

- `DOCHUB_MASTER_KEY` is absent or not a base64 32-byte key — there is no way
  to disable at-rest encryption.
- In production (`DOCHUB_PROD=1`), a required secret is still a dev default, or
  `DOCHUB_APP_ORIGIN == DOCHUB_USERCONTENT_ORIGIN` (the two-origin isolation is
  non-negotiable).
- The selected backend is missing its config (`DOCHUB_FS_ROOT` for `fs`; the
  `DOCHUB_S3_BUCKET` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` trio for
  `s3`).

Fail-fast is intentional — a misconfigured deploy never comes up half-working.

## Required configuration

| Variable | Purpose |
| --- | --- |
| `DOCHUB_APP_ORIGIN` | App origin (SPA, JSON API, editor byte streams). Session cookies live here only. |
| `DOCHUB_USERCONTENT_ORIGIN` | Isolated user-content origin (`/raw/{token}`). Must differ from the app origin in prod. |
| `DOCHUB_MASTER_KEY` | base64 32-byte master KEK. Wraps every per-workspace DEK. **Back this up out of band — losing it is unrecoverable.** |
| `DOCHUB_ADMIN_PASSWORD_HASH` | Argon2id hash of the seed admin password. |
| `DOCHUB_SESSION_SECRET` / `DOCHUB_WOPI_HMAC_SECRET` / `DOCHUB_SIGNED_URL_HMAC_SECRET` | 32-byte secrets; must not be dev defaults in prod. |
| `DOCHUB_DB_URL` | `sqlite:///path` (default `sqlite::memory:`) or a Postgres URL. Postgres for production. |
| `DOCHUB_BACKEND` + backend config | `fs` (`DOCHUB_FS_ROOT`), `s3`/MinIO/R2/B2 (`DOCHUB_S3_*` + `AWS_*`), or `memory` (dev only). |
| `DOCHUB_BIND` | Listen address, e.g. `0.0.0.0:8080`. |

Optional: `DOCHUB_MASTER_KEY_NEXT` (KEK rotation), `DOCHUB_OIDC_*` (SSO),
`DOCHUB_COLLAB_URL` (real-time co-editing — the sibling Hocuspocus/Yjs server;
usually a separate origin, e.g. `https://collab.<host>`), `DOCHUB_LOG_FORMAT=json`,
`DOCHUB_LOG_SAMPLE_RATE`, `DOCHUB_BODY_LIMIT_MB`, `DOCHUB_SIGNED_URL_TTL_SECS`,
`DOCHUB_STORAGE_SECRET_KEY` (bring-your-own storage). See
`dochub-core/src/config.rs` for the authoritative list.

The app-origin `Content-Security-Policy` is derived from this config at boot:
when `DOCHUB_COLLAB_URL` names a cross-origin collab server, its WebSocket
origin is added to `connect-src` automatically, so co-editing connects without
hand-editing any header. `script-src` stays strict (hashed inline bootstrap +
`'wasm-unsafe-eval'` for the editor engines, never `'unsafe-inline'`).

## Health & readiness

Three unauthenticated app-origin endpoints (send the app-origin `Host` header):

| Endpoint | Meaning | Use for |
| --- | --- | --- |
| `GET /healthz` | Process is up and serving. | Liveness probe. |
| `GET /readyz` | Metadata DB **and** object store both reachable (each time-bounded). `200` + `{"ready":true,...}` or `503` with per-check status. | Readiness / load-balancer gate. |
| `GET /metrics` | Prometheus exposition. | Scrape target. |

The container image ships a `HEALTHCHECK` that runs `dochub healthcheck`
internally (no `curl` needed), so `docker`/`compose` and orchestrators get
liveness for free.

## Monitoring

Scrape `GET /metrics`. Series exposed (all non-sensitive aggregates):

- `dochub_http_requests_total{class="2xx|3xx|4xx|5xx"}` — response counts.
- `dochub_http_requests_in_flight` — concurrency gauge.
- `dochub_http_request_duration_seconds` — latency histogram (`_bucket`/`_sum`/`_count`), 5 ms–10 s buckets.
- `dochub_uptime_seconds` — process uptime (resets on restart → deploy detector).
- `dochub_jobs{state="queued|running|failed"}` — background-job queue gauges (indexing + embedding). `queued` = backlog depth; `failed` = jobs parked after exhausting retries (need attention).
- `dochub_jobs_oldest_queued_age_seconds` — age of the oldest queued job = processing lag; `0` when the queue is drained. The earliest signal that indexing is falling behind (before search results go stale).

Starter alert expressions (PromQL):

```promql
# Elevated server-error rate (>1% of traffic over 5m)
sum(rate(dochub_http_requests_total{class="5xx"}[5m]))
  / sum(rate(dochub_http_requests_total[5m])) > 0.01

# p99 latency over 1s (5m window)
histogram_quantile(0.99,
  sum(rate(dochub_http_request_duration_seconds_bucket[5m])) by (le)) > 1

# Indexing/embedding backlog is stuck — oldest queued job waiting >10m
dochub_jobs_oldest_queued_age_seconds > 600

# Jobs are dying — anything parked in the failed state needs a look
dochub_jobs{state="failed"} > 0

# Readiness flapping / dependency down — alert on the probe from your prober.
```

Per-request detail comes from the `access_log` middleware (method, redacted
path, status, latency, user, workspace, client IP, request id). Set
`DOCHUB_LOG_FORMAT=json` for one JSON object per line. Under high traffic,
`DOCHUB_LOG_SAMPLE_RATE=0.1` logs one in ten *successful* requests; **5xx are
always logged**, and metrics still count every request. Successful `/healthz`,
`/readyz`, and `/metrics` probes are never logged (a failing probe is).

Every response carries an `X-Request-Id` header (a minted ULID when no upstream
proxy sets one), echoed on the access-log line. When a user reports a failure,
ask for that id and grep the logs for it.

## Backups

Three things must be captured for a complete, restorable backup:

1. **Metadata database** (`DOCHUB_DB_URL`) — all rows: files, versions, the
   hash chain, the append-only audit log, workspace keys (wrapped DEKs).
   - Postgres: `pg_dump` (a consistent snapshot).
   - SQLite: `sqlite3 <path> ".backup '<dest>'"` (never copy a live file).
2. **Object store** (the storage backend) — the encrypted, content-addressed
   blobs. S3/MinIO/R2/B2: server-side versioning + lifecycle, or `rclone`. `fs`:
   snapshot `DOCHUB_FS_ROOT`.
3. **Master KEK** (`DOCHUB_MASTER_KEY`, and `DOCHUB_MASTER_KEY_NEXT` mid-rotation)
   — stored **outside** the DB and object store, in a secrets manager. Blobs and
   DEKs are useless without it; **losing the KEK is unrecoverable data loss.**

Ordering for a consistent set: snapshot the DB first, then the object store
(blobs are write-once and content-addressed, so a blob newer than the DB
snapshot is simply unreferenced — never a dangling pointer).

## Restore

1. Provision the same `DOCHUB_MASTER_KEY` (and `_NEXT` if the backup was taken
   mid-rotation).
2. Restore the object store, then the metadata DB.
3. Point `DOCHUB_DB_URL` / backend config at the restored data and boot.
4. Verify: `GET /readyz` returns `200`, then spot-check a document opens and its
   version history verifies (see below).

## Master-KEK rotation

Lossless — re-wraps per-workspace DEKs, never rewrites document blobs. **Zero
downtime** when done in this order: while both keys are configured the running
server unwraps a DEK by trying the current KEK, then the next as a fallback
(`WorkspaceDeks::with_next_kek`), so reads never 500 on a mix of old-key and
re-wrapped rows. New DEKs are always sealed under the current KEK.

Drill:

1. **Set the next key + restart.** Add `DOCHUB_MASTER_KEY_NEXT` (base64 32-byte)
   alongside the current `DOCHUB_MASTER_KEY` and restart the server(s). Now the
   running process can read rows sealed under **either** key. (Do this restart
   *before* `rotate-kek`, so a row re-wrapped in the next step is immediately
   readable.)
2. **Re-wrap.** Run the admin subcommand: `dochub rotate-kek`. It unwraps each
   `workspace_keys` row under the current KEK, re-wraps the same DEK under the
   next KEK, bumps `key_version`, and prints a per-workspace `rotated`/`failed`
   report. It exits non-zero if any workspace failed, so automation can gate the
   cut-over. **Re-run until the report is clean** — it's idempotent (an already-
   rotated row is a no-op) and covers workspaces created during the window.
3. **Promote.** On a clean run, set `DOCHUB_MASTER_KEY` = the next key. Keep the
   **old** key as `DOCHUB_MASTER_KEY_NEXT` for a grace window (so any straggler
   still sealed under it keeps reading via the fallback) and restart.
4. **Finish.** Once you've confirmed a clean `rotate-kek` under the promoted key
   (nothing left under the old one), unset `DOCHUB_MASTER_KEY_NEXT` and restart.

Partial failure: if `rotate-kek` reports `failed` workspaces, **do not unset the
next key** — the fallback keeps them readable under whichever key sealed them.
Investigate the `failed` rows (a row that unwraps under neither key is corrupt or
predates the chain), fix or restore them, and re-run until clean.

`rotate-kek` is CLI/admin-only by design — there is no HTTP endpoint for it.

## Backup-restore verification drill

A backup you've never restored is a hope, not a backup. Periodically (and after
any backup-tooling change) prove the set is restorable end-to-end:

1. Restore DB + object store + KEK into a throwaway environment (see **Restore**).
2. `GET /readyz` → `200`.
3. Open a document and confirm bytes decrypt (exercises DEK unwrap → `get_blob`).
4. Verify a file's version chain and export+verify the audit log
   (`dochub verify-audit`) — proves the hash chains survived the round-trip.
5. Tear the environment down. Record the date; a backup unverified for a quarter
   is a risk, not an asset.

## Integrity & tamper response

The version chain and audit log are append-only and SHA-256 hash-chained;
verification recomputes hashes and links end-to-end and surfaces the **first**
break — never silently repaired.

- **Version chain of a file:** the app verifies on demand and raises a
  persistent tamper alarm to admins (audited) on a mismatch.
- **Audit-log export:** verify offline, no server needed —
  `dochub verify-audit <path-to-audit-export.json>` (exits non-zero on a broken
  chain or altered row).
- **Provenance manifest:** `dochub verify-provenance <path-to-manifest.json>`
  checks the Ed25519 signature + hash chain offline.

If a tamper alarm fires: it means stored bytes or ordering changed out from
under the app (storage compromise, manual DB edit, bit rot). Do **not** "repair"
it. Preserve the current state, pull the audit log, and restore the affected
blobs/rows from the last backup that verifies clean.

## Rolling deploys & shutdown

On `SIGTERM`/`SIGINT` the server stops accepting new connections and drains
in-flight requests, bounded to ~25 s (under the common 30 s orchestrator grace
period) so a single hung connection can't hold the process open until `SIGKILL`.
For zero-downtime rollouts, gate the new pod on `GET /readyz` before shifting
traffic, and let the old pod drain.
