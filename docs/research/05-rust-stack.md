# 05 — Rust Web Stack for Doc-Hub (2026)

State-of-the-ecosystem brief for the Doc-Hub backend: a single Rust binary serving an encrypted, tamper-evident document registry — the SPA with embedded editors, the JSON API, encrypted document byte streams, a `core`-backed content index, and an optional AI layer. Target deploy: one container on a $5 VPS (SQLite + fs); must also scale up cleanly (Postgres + S3/MinIO/R2/B2).

> Naming in flight: `drive-*`→`dochub-*`, `DRIVE_*`→`DOCHUB_*`. The crate tree may still read `drive-*` until the Phase 0 rename lands.

All version numbers, maintenance claims and crate URLs were cross-checked against crates.io / docs.rs / GitHub via WebSearch in 2026. Where a fact could not be confirmed from a fetched source it is tagged `[unverified]`.

## TL;DR

- **Axum 0.8.x** is the framework. Tokio-team owned, tower/hyper-native, ergonomic, the de-facto default. Actix is fine but socially isolated; Rocket is dormant; Poem is niche.
- **Core stack:** axum 0.8, tokio 1.4x, tower 0.5, tower-http 0.6, hyper 1.x, serde 1.0.228, tracing 0.1.41, thiserror 2.0.18 + anyhow 1.x.
- **Storage:** **OpenDAL** behind a thin `Storage` facade wrapping `opendal::Operator` (fs / memory / S3 / MinIO / R2 / B2), with a **mandatory at-rest encryption layer** — no handler ever touches the raw operator or plaintext bytes at rest.
- **Crypto (`dochub-crypto`):** AES-256-GCM envelope encryption via `aws-lc-rs`/`ring`; per-workspace DEK wrapped by a master KEK or external KMS; SHA-256 hash chains for versions + audit; Ed25519 (`ed25519-dalek`) for provenance signing. No homebrew primitives.
- **DB:** **SQLx** over SQLite (default) + Postgres (production); every migration portable.
- **Auth:** `tower-sessions` 0.15 + cookie auth; `argon2` for local passwords; `openidconnect` for OIDC (Auth Code + PKCE); `jsonwebtoken` for HMAC editor-access and signed-URL tokens. **Skip `axum-login`.**
- **Index (`dochub-index`):** `core` extracts text from every allowed format; **Tantivy** holds the full-text index in-process (single binary, no external search service).
- **AI (`dochub-ai`, optional):** a pluggable LLM provider — default Claude via the Anthropic API, local-model adapter for air-gapped installs — for semantic search, summaries, PII detection, cross-doc Q&A. Read-only.
- **`core` is a dependency, not re-implemented.** Text extraction, format parsing, and conversion live in the shared `core` engine.
- **SPA embedding:** `rust-embed` 8.x (single binary). **Build/deploy:** `cargo-chef` multi-stage Dockerfile, `debian:trixie-slim` runtime, strip + lto in release.

---

## 1. Framework: Axum vs Actix-Web vs Rocket vs Poem

| Framework  | Latest version | Maintenance | Notes |
|---|---|---|---|
| **axum**       | **0.8.8** (~Apr 2026 [unverified exact date]) | Active, Tokio team | Tower-native, hyper 1.x, AFIT-friendly, biggest ecosystem momentum |
| **actix-web**  | **4.13.0** (docs.rs head, 2026)   | Active, ~21k stars | Own runtime/middleware stack; mature; socially insulated from Tokio ecosystem |
| **rocket**     | **0.5.1** (docs.rs head; 0.5 GA Nov 2023) | Stagnant. No new news posts since 2023. | Macro-heavy ergonomics; dropped behind on async ecosystem evolution |
| **poem**       | **~unstated**, last commit Mar 13 2026 | Single-vendor (poem-web org) | Friendly API, OpenAPI bundled; small community |

### Maintenance and ecosystem fit

- **axum 0.8** (Jan 2025) brought `{name}` / `{*rest}` path syntax via matchit 0.8 — breaking but stabilising. Tower/hyper/tokio share one cabal of maintainers, so middleware (`tower-http`), sessions (`tower-sessions`), OIDC helpers, and observability all snap together.
- **actix-web 4.x** is fast and stable but ships its own runtime model and middleware trait. Every ecosystem narrative since 2023 has shifted toward tower; new crates target axum first. Real-world perf delta vs axum is single-digit-% and irrelevant for a document-hub workload.
- **Rocket** never resumed cadence after 0.5 GA. "Maintained, not developed." Avoid for greenfield in 2026.
- **Poem** is real and maintained, with built-in OpenAPI, but the bus factor is low and the crates we want (`tower-sessions`, `tower-http` middlewares) are not first-class there.

### Pick

**Axum 0.8.x.** Justification:
1. Doc-Hub needs streaming encrypted uploads/downloads, sessions, and middleware composition (two-origin CSP layers, rate limiting) — all best in axum because they're all `tower::Service`.
2. Editor byte-stream, content-search, and admin handlers map cleanly to axum extractors (typed path/query/headers, body as bytes/stream).
3. We can later put `tonic` (gRPC) or a Redis session store next to it without re-architecting.
4. AFIT support is fluent; the storage/crypto traits below work without macros for static dispatch.

Sources: [crates.io/axum](https://crates.io/crates/axum), [crates.io/actix-web](https://crates.io/crates/actix-web), [crates.io/rocket](https://crates.io/crates/rocket), [crates.io/poem](https://crates.io/crates/poem), [tokio.rs axum 0.8 release](https://tokio.rs/blog/2025-01-01-announcing-axum-0-8-0), [rust-web-framework-comparison](https://github.com/flosse/rust-web-framework-comparison).

## 2. Axum baseline crate stack

Confirmed against crates.io / docs.rs in 2026:

```toml
[dependencies]
axum                = "0.8"            # 0.8.8 latest
tokio               = { version = "1", features = ["full"] }   # 1.5x LTS line
tower               = "0.5"            # 0.5.3
tower-http          = { version = "0.6", features = ["trace", "cors", "limit", "compression-gzip", "set-header"] }   # 0.6.11
hyper               = "1"              # 1.8.1
serde               = { version = "1", features = ["derive"] } # 1.0.228
serde_json          = "1"              # 1.0.149
tracing             = "0.1"            # 0.1.41
tracing-subscriber  = { version = "0.3", features = ["env-filter", "json"] }
anyhow              = "1"              # 1.x
thiserror           = "2"              # 2.0.18 — 2.x is the current major
bytes               = "1"
futures             = "0.3"
```

Notable: `thiserror` is at **2.x** now; don't pin 1.x out of habit. `hyper` is firmly on the **1.x** line.

Sources: [crates.io/tokio](https://crates.io/crates/tokio), [crates.io/tower](https://crates.io/crates/tower), [crates.io/tower-http](https://crates.io/crates/tower-http), [crates.io/hyper](https://crates.io/crates/hyper), [crates.io/serde](https://crates.io/crates/serde), [crates.io/tracing](https://crates.io/crates/tracing), [crates.io/thiserror](https://crates.io/crates/thiserror).

## 3. Crate workspace

Doc-Hub is a workspace, not one crate. Dependency direction is strictly downward: `http` → {`auth`, `storage`, `crypto`, `index`, `ai`, `db`} → `core`.

```
crates/
  dochub-core/      Domain types, Config, error taxonomy. No I/O.
  dochub-db/        SQLx repos + migrations. SQLite + Postgres portable.
  dochub-crypto/    Envelope encryption, key wrap/rotate, hash chains, provenance signing.
  dochub-storage/   OpenDAL facade + mandatory encryption layer + BYO-bucket sealing.
  dochub-index/     core-backed text extraction → Tantivy full-text index (background worker).
  dochub-ai/        Optional LLM layer: semantic search, summaries, PII, Q&A.
  dochub-auth/      Sessions, Argon2id, OIDC, share links.
  dochub-http/      Axum router, two-origin middleware, every API + editor byte stream.
  dochub-bin/       Binary entry point; boot-time invariant checks.
```

`core` (the pure-Rust document engine, shared with the desktop suite) is a **vendored dependency**, not re-implemented here (CLAUDE working rule #6). `dochub-index` and `dochub-ai` call `core` for extraction; nothing else parses document formats.

### AppState

One `AppState` cloned cheaply (everything `Arc`-wrapped), handed to `Router::with_state`. Extractors pull what they need via `State<T>` / `FromRef`.

```rust
#[derive(Clone)]
pub struct AppState {
    pub storage: Arc<dyn Storage>,           // OpenDAL facade + encryption layer (§5)
    pub crypto:  Arc<KeyService>,            // KEK/DEK wrap-unwrap, hash-chain verify
    pub db:      Arc<Db>,                     // SQLx pool (sqlite or postgres)
    pub index:   Arc<dyn SearchIndex>,       // Tantivy-backed (§7)
    pub ai:      Option<Arc<dyn AiProvider>>,// optional (§8)
    pub sessions: SessionManagerLayer<…>,    // tower-sessions
    pub tokens:  Arc<TokenKeys>,             // HMAC editor-access + signed-URL keys
    pub config:  Arc<Config>,
}

let app = Router::new()
    .route("/api/files",                     get(api::list).post(api::upload))
    .route("/api/files/{id}/versions",       get(api::history))
    .route("/api/files/{id}/edit",           post(editor::mint_access))   // embedded editor byte stream
    .route("/api/search",                    get(search::query))
    .nest_service("/", spa_service)          // embedded SPA
    .with_state(state);
```

## 4. Authentication crates

| Crate | Latest | Maintenance | Use |
|---|---|---|---|
| `tower-sessions` | **0.15.0** (Feb 2026) | Active, Max Countryman | **Yes.** Cookie sessions as a tower layer; pluggable stores (SQLite/Postgres for prod, Redis when scaled). |
| `axum-login`     | **0.18.0**            | Active                 | Optional. Many teams skip it and write the ~30-line extractor on top of `tower-sessions`. **Skip for v0.** |
| `argon2`         | **0.5.3** (RustCrypto) | Active                 | Local password hashes. `Params::new(19456, 2, 1, None)` (OWASP minimum). |
| `openidconnect`  | **4.0.1** (ramosbugs) | Active                 | OIDC discovery, ID-token verification (Auth Code + PKCE). Built on `oauth2`. **Preferred for SSO.** |
| `oauth2`         | **5.0.0** (ramosbugs) | Active                 | Lower-level OAuth2; pulled transitively by `openidconnect`. |
| `jsonwebtoken`   | **10.4.0** (Keats)    | Active                 | Issue + verify our own short-lived tokens — **editor access tokens** and signed download URLs. `aws_lc_rs` backend. |

Recommendation:

- Browser sessions: **`tower-sessions`** (SQLite/Postgres-backed; Redis when the operator scales past one replica).
- SSO: **`openidconnect`** with Auth Code + PKCE (see brief 12).
- Editor access tokens and signed URLs: **`jsonwebtoken`** (HS256 with a server secret; rotate via key id).
- **Passwords:** `argon2id`, always — Doc-Hub has real accounts, projects, and roles, so local password hashing is not optional the way it was for the anonymous-Drive era.

Sources: [crates.io/tower-sessions](https://crates.io/crates/tower-sessions), [crates.io/axum-login](https://crates.io/crates/axum-login), [crates.io/argon2](https://crates.io/crates/argon2), [crates.io/oauth2](https://crates.io/crates/oauth2), [crates.io/openidconnect](https://crates.io/crates/openidconnect), [crates.io/jsonwebtoken](https://crates.io/crates/jsonwebtoken).

## 5. Storage facade + encryption (`dochub-storage` + `dochub-crypto`)

### The facade is OpenDAL, and it is always encrypted

03-storage settled the facade on **OpenDAL** (capability parity across backends, retry/tracing layers, Apache TLP governance) rather than a hand-rolled `aws-sdk-s3` trait. Doc-Hub adds a **non-negotiable at-rest encryption layer** in front of the operator:

```
write(key, plaintext)  →  crypto.seal(workspace_dek, plaintext)  →  operator.write(key, ciphertext)
read(key)              →  operator.read(key) → crypto.open(workspace_dek, ciphertext) → plaintext
```

- No handler holds an `opendal::Operator`; they hold `Arc<dyn Storage>`. Plaintext document bytes never reach a backend — enforced by construction and by a spy-backend property test.
- Storage keys are opaque ULIDs, never derived from user input. New backends are one more `opendal::services::*` builder; the trait does not grow.

AFIT status (mid-2026): native `async fn` in traits is stable since Rust 1.75 for **static** dispatch but still **not object-safe**. For `Arc<dyn Storage>` use **`#[async_trait]`** — one heap alloc per call, irrelevant next to I/O + AES.

```rust
#[async_trait]
pub trait Storage: Send + Sync + 'static {
    async fn head(&self, key: &str) -> Result<ObjectMeta, StorageError>;
    async fn get(&self, key: &str) -> Result<(ObjectMeta, ByteStream), StorageError>;
    async fn put(&self, key: &str, body: ByteStream) -> Result<ObjectMeta, StorageError>;
    async fn delete(&self, key: &str) -> Result<(), StorageError>;  // tombstone path; obeys retention/legal-hold above this layer
    async fn list(&self, prefix: &str) -> Result<Vec<ObjectMeta>, StorageError>;
}
```

Note there are **no `lock`/`unlock` methods** — WOPI locking is demoted to the optional interop crate and does not shape the core storage trait. Streams settle on `impl Stream<Item = Result<Bytes, StorageError>> + Send + 'static`; `bytes::Bytes` is the currency for axum, hyper, and OpenDAL.

### `dochub-crypto` primitives

| Concern | Crate | Notes |
|---|---|---|
| AEAD | **`aws-lc-rs`** (or `ring`) | AES-256-GCM, random 96-bit nonce per blob, stored `nonce ‖ ciphertext ‖ tag`. No homebrew. |
| Key wrapping | `aws-lc-rs` AES-KW / GCM | Per-workspace DEK wrapped by the master KEK (`DOCHUB_MASTER_KEY`) or an external KMS. Only wrapped DEKs persist. |
| Hash chain | `sha2` (SHA-256) | `content_hash = SHA-256(ciphertext)`, `prev_hash` links versions and audit rows. `verify_chain` recomputes end-to-end. |
| Provenance signing | **`ed25519-dalek`** | Ed25519 signatures for issued/registered documents and optional chain-head anchoring. |
| KMS adapters | `aws-sdk-kms` (optional, feature-gated) | Envelope KEK held in a cloud KMS for operators who want it. |

Boot **refuses to start** without a master KEK or configured KMS. Keys never appear in logs, errors, or responses. Key rotation re-wraps DEKs without rewriting document blobs.

## 6. Database (`dochub-db` — SQLx)

- **`sqlx`** with the `sqlite` + `postgres` features, compile-time-checked queries, and a portable migration set. SQLite is the default and only required engine for a $5-VPS install; Postgres is the production target.
- Portability rules (enforced in review + CI): TEXT ULID ids, ISO-8601 UTC timestamps, INTEGER 0/1 bools. **No** JSONB, native enums, or native UUID columns.
- Core tables: `users`, `sessions`, `workspaces` (+`workspace_members`, `workspace_invitations`, `workspace_storage`), `folders`, `files` (+`file_versions`), `audit_log`, `share_links`, `retention_policies`, `legal_holds`, `oidc_*`.
- The `file_versions` and `audit_log` tables are **append-only** at the application layer; repos expose no `UPDATE`/`DELETE` for committed rows.

CI runs the full test matrix against both engines via `testcontainers` (Postgres) and an ephemeral SQLite file, so both portability targets stay green.

## 7. Content index (`dochub-index` — `core` + Tantivy)

Search reads document *content*, not just names. This only works because the encryption model is server-trusted: the server can decrypt, extract, and index.

- **Extraction:** `core` turns each allowed format (docx/xlsx/pdf/md/txt/csv/json/yaml — PDF via text layer, OCR fallback later) into normalised text. Never re-implemented here.
- **Index:** **Tantivy** (Rust, Lucene-shaped) holds the full-text index **in-process** — no external OpenSearch/Elasticsearch service to run. This keeps the single-binary, $5-VPS promise intact while still indexing content.
- **Worker:** a lazy background worker (mirroring the retired thumbnail-worker pattern) driven by a `files.index_state` column (`pending|ready|unsupported|failed`). On a new version it re-extracts and re-indexes; on tombstone it removes the document from the index.
- Search unions Tantivy content hits with SQL metadata and returns snippets + highlights.

Crates: `tantivy` (index), plus `core` for extraction. No `aws-sdk`/OpenSearch client.

## 8. AI layer (`dochub-ai`, optional)

`dochub-ai` sits beside search and is entirely optional — an install can run without it.

- **Capabilities:** semantic search (embeddings + rerank alongside Tantivy, never replacing exact retrieval for compliance-critical queries), document/section summaries, entity + PII detection (suggestions, human-approved), cross-document Q&A.
- **Read-only by construction:** it never mutates documents or history; every AI action is audited.
- **Provider is pluggable** behind an `AiProvider` trait. Default: **Claude via the Anthropic API** (`anthropic` SDK) — Haiku for extraction/classification, Sonnet/Opus for reasoning/Q&A. A **local-model adapter** (e.g. llama.cpp/ONNX via a Rust binding) serves air-gapped installs. Provider choice is `Config`-driven; the trait keeps handlers provider-agnostic.

```rust
#[async_trait]
pub trait AiProvider: Send + Sync {
    async fn embed(&self, chunks: &[&str]) -> Result<Vec<Embedding>, AiError>;
    async fn summarize(&self, text: &str, scope: Scope) -> Result<Summary, AiError>;
    async fn detect_pii(&self, text: &str) -> Result<Vec<PiiSpan>, AiError>;
    async fn answer(&self, question: &str, ctx: &[Passage]) -> Result<Answer, AiError>;
}
```

## 9. File upload + editor byte streams

Axum exposes `axum::extract::Multipart` (from `multer`). Two rules: raise the default 2 MB body limit with `DefaultBodyLimit::disable()` on the upload route (gate size in the handler / `RequestBodyLimitLayer` for a hard cap), and keep `Multipart` **last** in the handler signature since it consumes the body.

The ingest handler enforces the **documents-only allowlist** — by extension *and* magic-byte sniff — before anything is sealed and written. Disallowed types are rejected, not quarantined.

```rust
async fn upload(State(s): State<AppState>, mut mp: Multipart) -> Result<Json<UploadResp>, AppError> {
    while let Some(field) = mp.next_field().await? {
        if field.name() == Some("file") {
            let bytes = field.bytes().await?;                       // small docs; stream for large
            allowlist::check(&filename, &bytes)?;                   // extension + magic-byte sniff
            let version = s.commit_new_version(&bytes).await?;      // seal → write-once → hash-chain → audit → enqueue reindex
            return Ok(Json(version.into()));
        }
    }
    Err(AppError::missing_field("file"))
}
```

For **editing**, the primary path is embedded, not WOPI: the app origin mints a short-TTL HMAC **editor access token** `(user_id, file_id, perms, exp, jti)`; the server decrypts bytes in memory and streams them to the embedded editor over the authenticated app origin; save re-seals, appends a hash-chained version, audits, and enqueues reindex. WOPI stays available as **optional interop** for external Office clients in a separate `dochub-wopi` interop module — not on the hot path.

Sources: [axum::extract::Multipart docs](https://docs.rs/axum/latest/axum/extract/multipart/index.html), [axum streaming upload discussion #1638](https://github.com/tokio-rs/axum/discussions/1638).

## 10. Observability

```rust
tracing_subscriber::registry()
    .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,hub=debug,tower_http=info".into()))
    .with(fmt::layer().json())
    .init();

let app = Router::new()
    .route(/* … */)
    .layer(tower_http::trace::TraceLayer::new_for_http());
```

Structured per-request logs (method, path, status, latency). Redact `Authorization`, `Cookie`, editor-access tokens, and — critically — **never log document bytes, plaintext, or keys**. OpenTelemetry is optional and off by default behind an `otel` cargo feature so the $5-VPS build doesn't pay for it.

Sources: [crates.io/tracing-opentelemetry](https://crates.io/crates/tracing-opentelemetry), [opentelemetry.io/docs/languages/rust](https://opentelemetry.io/docs/languages/rust/).

## 11. Testing

Layers (full contract in `docs/TESTING.md`):

1. **Unit** — crypto primitives, hash-chain math, config parsing, path confinement, token signing, repo query builders.
2. **Property (`proptest`)** — `open(seal(x)) == x`; chain verification; append-only immutability; restore-is-additive; key rotation is lossless.
3. **Integration** — crates against real SQLite + Postgres and real OpenDAL backends via `testcontainers`; a spy backend asserts ciphertext-at-rest.
4. **Router integration** — `tower::ServiceExt::oneshot` on the configured `Router` (`.with_state(state)` first).
5. **End-to-end** — Playwright against the built binary, one test per named use-case (onboard, upload+reject, edit→version, restore, co-edit, content search, share, audit/retention, provenance, AI).

Coverage gate ≥ 85% (`cargo llvm-cov`); new crypto/immutability code targets 100% branch coverage.

Sources: [axum testing example](https://github.com/tokio-rs/axum/blob/main/examples/testing/src/main.rs), [docs.rs — testcontainers-modules](https://docs.rs/testcontainers-modules/latest/).

## 12. Build & deploy

Release profile (root `Cargo.toml`):

```toml
[profile.release]
lto = "thin"
codegen-units = 1
strip = "symbols"
panic = "abort"
```

Multi-stage Dockerfile with `cargo-chef` (≈5x faster rebuilds):

```dockerfile
# syntax=docker/dockerfile:1.7
FROM rust:1.85 AS chef
RUN cargo install cargo-chef --locked
WORKDIR /app

FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json   # cached layer: deps only
COPY . .
RUN cargo build --release --bin hub

FROM debian:trixie-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/hub /usr/local/bin/hub
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/hub"]
```

Planner, builder, and cached image must share the **same Rust toolchain version** or cache reuse silently breaks.

Sources: [cargo-chef README](https://github.com/LukeMathWalker/cargo-chef/blob/main/README.md), [Luca Palmieri — 5x faster rust docker builds](https://lpalmieri.com/posts/fast-rust-docker-builds/).

## 13. SPA embedding

- **`rust-embed` 8.x** — embeds `web/dist/` at compile time in release, reads from disk in dev. SPA-fallback is one match arm. **Pick this.**
- `include_dir` (simpler, no dev hot-reload) and `axum-embed` (convenience `Service` wrapper) are alternatives; a split reverse-proxy service is overkill for a $5-VPS at v0.

```rust
#[derive(rust_embed::Embed)]
#[folder = "web/dist/"]
struct Assets;

async fn spa(uri: Uri) -> impl IntoResponse {
    let path = uri.path().trim_start_matches('/');
    match Assets::get(path).or_else(|| Assets::get("index.html")) {
        Some(f) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            ([(CONTENT_TYPE, mime.as_ref())], f.data.into_owned()).into_response()
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}
```

Sources: [crates.io/rust-embed](https://crates.io/crates/rust-embed), [crates.io/include_dir](https://crates.io/crates/include_dir), [crates.io/axum-embed](https://crates.io/crates/axum-embed).

## 14. Doc-Hub starter blueprint

Root `Cargo.toml` workspace + representative deps:

```toml
[workspace]
members = ["crates/*"]

# dochub-http (representative)
[dependencies]
# http stack
axum                = { version = "0.8", features = ["multipart", "macros"] }
tokio               = { version = "1",  features = ["full"] }
tower               = "0.5"
tower-http          = { version = "0.6", features = ["trace", "cors", "limit", "compression-gzip", "set-header"] }
hyper               = "1"

# data
serde               = { version = "1", features = ["derive"] }
serde_json          = "1"
bytes               = "1"
futures             = "0.3"
time                = { version = "0.3", features = ["serde", "formatting"] }
ulid                = "1"

# db
sqlx                = { version = "0.8", features = ["runtime-tokio", "sqlite", "postgres", "migrate", "macros"] }

# storage + crypto
opendal             = { version = "0.5x", features = ["services-fs", "services-memory", "services-s3"] }  # [unverified exact version]
async-trait         = "0.1"
aws-lc-rs           = "1"
sha2                = "0.10"
ed25519-dalek       = "2"
aws-sdk-kms         = { version = "1", optional = true }   # behind `kms` feature

# index + ai
tantivy             = "0.22"                               # full-text index (in-process)
# core                = { path = "../core" }               # vendored extraction engine

# auth
tower-sessions      = "0.15"
argon2              = "0.5"
jsonwebtoken        = { version = "10", default-features = false, features = ["aws_lc_rs"] }
openidconnect       = { version = "4", optional = true }   # behind `oidc` feature

# error / log
anyhow              = "1"
thiserror           = "2"
tracing             = "0.1"
tracing-subscriber  = { version = "0.3", features = ["env-filter", "json"] }

# spa
rust-embed          = { version = "8", features = ["mime-guess"] }
mime_guess          = "2"

[dev-dependencies]
proptest                = "1"
testcontainers          = "0.27"
testcontainers-modules  = { version = "0.13", features = ["postgres", "minio"] }
tower                   = { version = "0.5", features = ["util"] }   # ServiceExt::oneshot
http-body-util          = "0.1"

[features]
default = []
oidc    = ["dep:openidconnect"]
kms     = ["dep:aws-sdk-kms"]
ai      = []      # gates dochub-ai wiring
otel    = []
```

`main.rs` sketch (`dochub-bin`), boot invariants first:

```rust
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    hub::observability::init();
    let cfg = hub::config::load()?;

    // Fail-fast boot invariants (asserted + tested):
    hub::crypto::require_master_key(&cfg)?;           // refuse to start without a KEK/KMS
    hub::http::require_distinct_origins(&cfg)?;       // refuse prod if app_origin == usercontent_origin
    let db      = hub::db::connect_and_migrate(&cfg).await?;
    let storage = hub::storage::from_config(&cfg).await?;   // Arc<dyn Storage>, encryption layer wired

    let state = hub::state::AppState::new(cfg.clone(), db, storage).await?;
    let app   = hub::http::router(state)
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .layer(tower_http::compression::CompressionLayer::new());

    let listener = tokio::net::TcpListener::bind(cfg.bind).await?;
    tracing::info!(addr = %cfg.bind, "hub listening");
    axum::serve(listener, app).await?;
    Ok(())
}
```

This compiles to a single static binary (linked via `aws_lc_rs`, no OpenSSL system dep) that ships in a ~20–40 MB Debian-slim image and runs comfortably on a $5 VPS, while leaving every seam — storage backend, KMS, session store, IdP, AI provider — swappable for scale-up.

---

## Sources (fetched)

- [crates.io — axum](https://crates.io/crates/axum) · [axum versions](https://crates.io/crates/axum/versions) · [tokio.rs — Announcing axum 0.8.0](https://tokio.rs/blog/2025-01-01-announcing-axum-0-8-0)
- [crates.io — actix-web](https://crates.io/crates/actix-web) · [rocket](https://crates.io/crates/rocket) · [poem](https://crates.io/crates/poem) · [rust-web-framework-comparison](https://github.com/flosse/rust-web-framework-comparison)
- [crates.io — tokio](https://crates.io/crates/tokio) · [tower](https://crates.io/crates/tower) · [tower-http](https://crates.io/crates/tower-http) · [hyper](https://crates.io/crates/hyper) · [serde](https://crates.io/crates/serde) · [tracing](https://crates.io/crates/tracing) · [thiserror](https://crates.io/crates/thiserror) · [anyhow](https://crates.io/crates/anyhow)
- [crates.io — tower-sessions](https://crates.io/crates/tower-sessions) · [axum-login](https://crates.io/crates/axum-login) · [argon2](https://crates.io/crates/argon2) · [oauth2](https://crates.io/crates/oauth2) · [openidconnect](https://crates.io/crates/openidconnect) · [jsonwebtoken](https://crates.io/crates/jsonwebtoken)
- [apache/opendal](https://github.com/apache/opendal) · [crates.io — opendal](https://crates.io/crates/opendal) · [crates.io — sqlx](https://crates.io/crates/sqlx)
- Crypto: [crates.io — aws-lc-rs](https://crates.io/crates/aws-lc-rs) · [ring](https://crates.io/crates/ring) · [sha2](https://crates.io/crates/sha2) · [ed25519-dalek](https://crates.io/crates/ed25519-dalek) · [aws-sdk-kms](https://crates.io/crates/aws-sdk-kms)
- Index/AI: [crates.io — tantivy](https://crates.io/crates/tantivy) · [`core` engine](https://github.com/schnsrw/core) · [Anthropic API](https://docs.anthropic.com/)
- [async fn / RPIT in traits (1.75)](https://blog.rust-lang.org/2023/12/21/async-fn-rpit-in-traits/) · [async fn in dyn trait](https://rust-lang.github.io/async-fundamentals-initiative/explainer/async_fn_in_dyn_trait.html) · [crates.io — async-trait](https://crates.io/crates/async-trait)
- [docs.rs — axum::extract::Multipart](https://docs.rs/axum/latest/axum/extract/multipart/index.html) · [axum discussion #1638](https://github.com/tokio-rs/axum/discussions/1638)
- [crates.io — rust-embed](https://crates.io/crates/rust-embed) · [include_dir](https://crates.io/crates/include_dir) · [axum-embed](https://crates.io/crates/axum-embed)
- [github.com/LukeMathWalker/cargo-chef](https://github.com/LukeMathWalker/cargo-chef) · [Luca Palmieri — 5x faster Rust Docker builds](https://lpalmieri.com/posts/fast-rust-docker-builds/)
- [axum testing example](https://github.com/tokio-rs/axum/blob/main/examples/testing/src/main.rs) · [docs.rs — testcontainers-modules](https://docs.rs/testcontainers-modules/latest/)
