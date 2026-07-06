# 16 — Scale infra (index worker, Redis, AI) (later phase)

Doc-Hub ships single-binary by design. Until ~50 concurrent users, the in-process defaults — SQLite/Postgres for metadata, in-process rate limit, in-process presence hub, an **embedded `core` + Tantivy** content index, and an optional in-process AI layer — carry the load, and operators don't need to run any extra service.

Past that threshold — or the moment Doc-Hub runs as more than one replica behind a load balancer — some of those defaults start to bite. This brief locks the shape of the opt-in scaling path so operators can flip env vars and scale without rewrites.

> Naming in flight: `drive-*`→`dochub-*`, `DRIVE_*`→`DOCHUB_*`.

## Why now

Three triggers force the conversation:

1. **>50 concurrent users on one instance.** The in-process rate-limit map grows unbounded, the SSE presence hub allocates `O(users × subscribers)` per fan-out, and the `dochub-index` worker's extraction+embedding queue can fall behind on bursty uploads. None of it falls over yet — but the operator's CPU graph stops being flat.
2. **More than one Doc-Hub replica.** The moment a deployment runs `N > 1` instances behind a load balancer, in-process state (rate limit, sessions if `MemoryStore`, presence hub, BYO adapter cache) becomes per-instance — users get a different bucket on every request, presence breaks, and each replica holds its own Tantivy index unless the index is shared.
3. **AI at volume.** The optional `dochub-ai` layer calls an LLM provider (default Claude via the Anthropic API) for embeddings, summaries, PII detection, and Q&A. Under load that means provider rate limits, batching, and an embedding store that outgrows in-process memory.

All three are deferred from v0 on purpose: a self-hoster on a $5 VPS shouldn't need Redis or a GPU to read their own documents. The opt-in lets them stay on the simple path until they've outgrown it.

## What does NOT change: search is `core` + Tantivy

The single most important scaling decision is what we **don't** do: Doc-Hub does **not** adopt OpenSearch/Elasticsearch as its search backend. Content search — the product feature of finding a phrase *inside* a `.docx`/`.pdf`/`.xlsx` — is served by the Rust `core` extraction engine feeding a **Tantivy** full-text index, embedded in the binary. Tantivy stays the search engine at every scale; scaling search means scaling the *index worker* and *sharing the index across replicas*, not swapping the engine (00-synthesis tension #6).

Why Tantivy over an external search cluster:
- It keeps the single-binary, $5-VPS promise — no second service to run just to search your own hub.
- The index is a **derived view**: it can be dropped and rebuilt from the authoritative SQL rows + encrypted blobs at any time.
- For compliance-critical retrieval, exact full-text (BM25) must never be silently replaced by fuzzy/semantic results; keeping the exact engine in-house guarantees that.

## Locked decisions

### **Redis is the one optional shared-state service**

- **Redis** — the escape hatch for ephemeral shared state across replicas: rate limit, session store, presence hub, BYO adapter cache invalidation. Same Redis instance for all four (different key prefixes).
- No MeiliSearch, no OpenSearch, no Elasticsearch, no SOLR — search is Tantivy (above). No second datastore beyond Redis.

```
DOCHUB_REDIS_URL=redis://redis.internal:6379/0
```

If unset, Doc-Hub runs in-process for everything. Operators read the same env-var matrix as the rest of the config.

### **Trait at the boundary, two impls per surface**

Every surface that needs the escape hatch sits behind a trait shipping two implementations:

| Surface | Trait | In-process impl | Redis impl |
|---|---|---|---|
| Rate limit | `RateLimiterBackend` | `InMemoryLimiter` | `RedisLimiter` (Lua script for atomic refill) |
| Session store | `SessionStore` (tower-sessions) | `SqlStore` | `RedisStore` (inherited directly from `tower-sessions`) |
| Presence hub | `PresenceHubBackend` | `InProcessHub` | `RedisPubSubHub` (channel `presence:{workspace_id}`) |
| BYO cache invalidation | `StorageCacheBus` | `NoopBus` | `RedisPubSubBus` |

`Config::from_env` reads `DOCHUB_REDIS_URL` and the binary picks the right impl at boot. Handlers see only the trait.

### **The content index worker scales before anything external does**

`dochub-index` owns the pipeline: on a new committed version, extract text via `core`, normalise, and write to the Tantivy index; a `files.index_state` column (`pending|ready|unsupported|failed`) drives it. Scaling knobs, in order of reach-for:

1. **Bounded concurrency + backpressure.** The worker drains a `tokio::sync::mpsc` queue with a fixed worker-pool size (`DOCHUB_INDEX_WORKERS`). Bursty uploads queue as `pending`; the UI shows "indexing" rather than blocking the save.
2. **Incremental + idempotent.** Every write to `files` enqueues a job; on boot the worker delta-syncs rows newer than the last-indexed watermark. No full reindex on restart. Re-extract on new version; remove from the index on tombstone.
3. **Durable queue when volume justifies.** Promote the in-process `mpsc` to a persisted job queue (a `jobs` table drained with `SELECT … FOR UPDATE SKIP LOCKED`, or a crate like `sqlxmq`/`apalis`) so index work survives restarts and can be drained by a dedicated worker process.
4. **Shared index for multi-replica.** Tantivy is single-writer. For `N > 1` replicas: a single **indexer replica** owns writes; readers open the index read-only over shared storage (a shared volume, or a periodically-synced index directory in object storage). `/api/admin/reindex` drops + rebuilds from the authoritative SQL + blobs after schema changes or corruption.

The index only holds extracted **plaintext** derived from documents the server already decrypts — consistent with the server-trusted threat model (06 §0). It is never the source of truth.

### **AI scaling (`dochub-ai`, optional)**

The AI layer is off by default and scales independently of search:

- **Provider is pluggable** behind an `AiProvider` trait. Default: Claude via the Anthropic API (Haiku for extraction/classification, Sonnet/Opus for reasoning). A local-model adapter serves air-gapped installs with no egress.
- **Embeddings are batched** and computed on the same index-worker cadence (a new version enqueues an embed job alongside the Tantivy job). Batch size + debounce are configurable to respect provider rate limits.
- **Embedding store.** Vectors live beside the Tantivy index; for larger corpora, a vector index (e.g. an HNSW segment / a pgvector table when on Postgres) is added behind the same `AiProvider` retrieval trait. Semantic hits **rerank alongside** Tantivy exact results — never replacing them for compliance-critical retrieval.
- **Rate-limit + circuit-break the provider.** Provider calls go through the same circuit-breaker middleware as the optional services; on provider failure, AI features degrade gracefully to plain Tantivy search and the SPA hides the AI affordances. Every AI call is audited and read-only.
- **Cost + privacy controls.** Per-workspace toggles; the local-model adapter for installs that must not send content off-box.

### **Health-check + circuit-break on the optional services**

- Boot probe: connect + ping. If `DOCHUB_REDIS_URL` (or an AI provider) is configured but unreachable, **boot fails** — the operator opted in, deserves the loud failure.
- Runtime: every call goes through a `tower` middleware that opens a circuit breaker on 5 consecutive failures over 10s, falls back to in-process (or degrades AI) for 60s, retries. Surfaced in `/api/admin/system` as `redis_status` / `ai_status`: `healthy | circuit_open | unconfigured`.

## Locked-out decisions

- **OpenSearch/Elasticsearch for content search.** No. Tantivy is the engine at every scale; the index is a rebuildable derived view. An external search cluster is a second source of truth and breaks the single-binary promise.
- **Redis-as-cache-of-SQL-rows.** Tempting, skipped: caching rows adds an invalidation surface, and the metadata DB is the cheapest piece of the stack. Cache when measured, not before.
- **OpenSearch for the audit log.** No — the audit log is authoritative, append-only, and hash-chained in SQL; it is never mirrored into a rebuildable index.
- **Index/embeddings as the source of truth.** No. SQL rows + encrypted, hash-chained blobs are authoritative; Tantivy and the vector store are derived and rebuildable.
- **Multi-region Redis clusters.** Operator concern, not Doc-Hub's. We document "any reachable URL works" and stop.

## Threat model

| Risk | Mitigation |
|---|---|
| **Redis password in `DOCHUB_REDIS_URL` leaks via logs** | URL redactor middleware redacts `Authorization`, `Cookie`, `?access_token=`; add `redis://*` redaction (replace `:<pwd>@` with `:***@`). |
| **AI provider key leaks via logs** | `DOCHUB_AI_API_KEY` redacted at the config + HTTP layer; never echoed in errors or `/api/admin/system`. |
| **Content exfiltration via the AI provider** | Off by default; per-workspace opt-in; local-model adapter for air-gapped installs; every AI call audited. AI is read-only and never receives keys or writes storage. |
| **Index leaks content across workspaces** | Every indexed doc carries `workspace_id`; every query filters on `workspace_id ∈ caller's memberships`. No `_all`/cross-workspace queries from user-facing endpoints. |
| **Stolen Redis credentials → presence forgery** | Presence rides alongside the audit log; the audit log is authoritative in SQL. A Redis attacker can spam events but cannot fake history. |
| **Index corruption / tamper** | The index is a derived view — `/api/admin/reindex` rebuilds it from the hash-chained authoritative blobs; a rebuilt index that disagrees with `verify_chain` surfaces a tamper alarm on the source, not the index. |
| **Redis connection exhaustion DoS** | `bb8-redis` pool with `max_size` matching worker count; presence subscribers reuse a single pubsub connection. |

## Config

```
DOCHUB_REDIS_URL=redis://user:pass@host:6379/0     # opt-in; rate limit, sessions, presence, cache bus
DOCHUB_INDEX_WORKERS=4                             # Tantivy/extraction worker-pool size
DOCHUB_INDEX_DIR=/data/index                       # Tantivy index location (shared volume for multi-replica)
DOCHUB_INDEX_ROLE=writer|reader                    # multi-replica: exactly one writer owns index writes
DOCHUB_AI_PROVIDER=anthropic|local|none            # default none (AI off)
DOCHUB_AI_API_KEY=<provider key>                   # required when provider=anthropic
DOCHUB_AI_EMBED_BATCH_SIZE=64                       # batch size for embedding jobs
DOCHUB_AI_EMBED_INTERVAL_MS=2000                    # debounce
```

## Endpoints affected

| Endpoint | Single instance (default) | With Redis | With AI enabled |
|---|---|---|---|
| `POST /api/auth/sign-in` | SQL session | SQL or `RedisStore` (env-picked) | unchanged |
| `POST /api/files` (upload / new version) | SQL write + audit + enqueue index job | + Redis-backed rate limit | + enqueue embed job |
| `GET /api/search` | Tantivy content query + SQL metadata | unchanged | + semantic rerank alongside Tantivy |
| `GET /api/presence/{ws}` | in-process hub | Redis PUBSUB hub | unchanged |
| `POST /api/admin/reindex` | drop + rebuild Tantivy from SQL + blobs | unchanged | also rebuilds embeddings |

## Implementation surface

Traits + one boot wire-up:

- `crates/dochub-cache/` (new) — thin Redis facade with the four traits; in-process default impls where they exist today.
- `crates/dochub-index/` — the Tantivy `SearchIndex` trait + `core`-backed extraction worker (already core to the product, extended here with worker-pool + durable-queue knobs).
- `crates/dochub-ai/` — the optional `AiProvider` trait + Anthropic and local-model adapters; embedding worker.
- `crates/dochub-auth/src/session_store.rs` — picker between SQL and Redis stores.
- `crates/dochub-http/src/state.rs` — `AppState` gains the rate-limit + presence trait swaps.
- `crates/dochub-bin/src/main.rs` — env-driven picker at boot, health probes, `tracing::info!` per-surface status.

## Test plan

- Compile-time: `dochub-cache` compiles with both `redis` and `default-features = false`; feature-gated Redis tests run only in CI with a sidecar Redis.
- Index: `dochub-index` unit + integration — extract a golden `.docx`/`.pdf`/`.xlsx`, assert the phrase is found; reindex on new version; index removal on tombstone; `reindex` rebuilds from blobs and matches.
- Multi-replica: a `scripts/` compose brings up 2 Doc-Hub replicas (one `writer`, one `reader`) + Redis, runs a Playwright test that signs in on one replica and sees presence + freshly-indexed content on the other.
- AI (when enabled): semantic query surfaces a doc keyword search misses; provider circuit-break degrades gracefully to Tantivy; every AI call is read-only and audited; local-model adapter produces no network egress (asserted).
- Smoke: in-process impls keep their existing tests verbatim — the trait extraction must not break them.

## When to ship

Deferred until the first operator outgrows in-process. Concrete triggers — any of:

- `/api/admin/system` reports `rate_limit_buckets > 1000` for a sustained hour.
- An operator opens an issue saying they run >1 replica.
- The `dochub-index` queue depth stays above a threshold (extraction can't keep up with uploads).
- AI features are enabled at a volume that hits provider rate limits.

Until then, the in-process defaults — Redis-free, single Tantivy index, AI off — are correct.
