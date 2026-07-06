# Storage Abstraction Layer — Research Brief

Doc-Hub needs one storage API behind four interchangeable adapters: filesystem, in-memory, S3, MinIO (plus R2/B2 via the S3 path). The question is whether to consume an existing unified SDK or roll our own trait — and, above that, how to bolt a **mandatory at-rest encryption layer** onto the facade so no plaintext document bytes ever reach a backend. This brief grounds the answer in current upstream sources.

> The facade is not just a storage abstraction; it is the encryption boundary. Every write goes `plaintext → dochub-crypto.seal → operator.write(ciphertext)`; every read reverses it. There is no code path that writes plaintext document bytes to a backend, and no config that disables encryption (`CLAUDE.md`, `ARCHITECTURE.md`). Everything about OpenDAL below sits *underneath* that layer.

## TL;DR

- Apache **OpenDAL** (TLP since 2024-01-18, latest v0.54.1 2025-10-13) already implements all four of our adapters (`s3`, `fs`, `memory`, MinIO via `s3` + custom endpoint) plus 40+ more, behind one `Operator` API. It moves **opaque ciphertext blobs**; it never sees plaintext.
- **Mandatory encryption layer.** The `Storage` facade seals bytes with `dochub-crypto` (AES-256-GCM envelope encryption, per-workspace DEK wrapped by a master KEK/KMS) before `operator.write`, and opens them after `operator.read`. Boot refuses to start without a key.
- **Write-once, content-addressed.** Document versions are write-once blobs keyed by **opaque ULIDs** (never derived from user input or filename); `content_hash = SHA-256(ciphertext)`. The facade never overwrites a committed blob — the immutable version engine owns that invariant.
- **`object_store`** (Apache Arrow) covers S3, GCS, Azure, memory, local fs. Narrower trait. Portable signed-URL support is still partial.
- OpenDAL surfaces per-backend feature gaps through a typed `Capability` struct (`op.info().full_capability().presign_read`) — the cleanest way to handle "S3 has presign, fs doesn't" without a leaky trait.
- For fs and memory, presign is self-minted: HMAC-SHA256 token over `(key, expiry, method)`, served from `/raw/{token}` in Axum on the user-content origin.
- A hand-rolled trait is ~150–250 LoC of trait + ~1.5–3k LoC across four impls and reinvents capability gates, retry layers, signed-URL abstraction, list pagination, multipart chunking.
- **Recommendation: build on OpenDAL** behind a thin `Storage` facade (~80–120 LoC + the encryption layer) that hides `Operator`, wraps every read/write in seal/open, and adds the `/raw/{token}` fallback when `capability.presign_read == false`.
- Conformance: one `rstest` suite per backend factory; MinIO via `testcontainers-modules` `minio` feature; plus a **spy-backend property test** asserting the bytes handed to the operator are always ciphertext.
- Path model: Unix-style, leading slash optional, `//` collapsed — adopt OpenDAL's RFC-0112 rules verbatim; keys are opaque ULIDs.

## 1. OpenDAL Deep-Dive

OpenDAL ("One Layer, All Storage") graduated from the Apache Incubator on 2024-01-18 with 19 committers, 164 contributors, 10 known production users, 263 dependent GitHub projects \[1\], \[2\]. Apache-2.0, repo `apache/opendal`. Latest core release **v0.54.0 (2025-07-17)**, patch v0.54.1 (2025-10-13) \[3\].

### Architecture: Operator + Builder + Layer

Public surface is three pieces \[4\], \[5\]:

- **`Builder`** — typed per-service struct (`services::S3`, `services::Fs`, `services::Memory`), fluent setters.
- **`Operator`** — `Send + Sync + Clone`, stateless. All handler code talks to this.
- **`Layer`** — middleware: `RetryLayer`, `TimeoutLayer`, `LoggingLayer`, `TracingLayer`, `MetricsLayer`, `ConcurrentLimitLayer`, `ThrottleLayer` \[6\]. `OperatorBuilder::layer()` is **static dispatch — zero cost**.

S3 wire-up from upstream service docs \[7\]:

```rust
use opendal::{Operator, services::S3};

let builder = S3::default()
    .bucket("dochub")
    .region("us-east-1")
    .endpoint("https://s3.amazonaws.com")
    .access_key_id(&key)
    .secret_access_key(&secret);

let op: Operator = Operator::new(builder)?
    .layer(opendal::layers::RetryLayer::default())
    .layer(opendal::layers::TracingLayer)
    .finish();
```

MinIO is just S3 with a custom endpoint and `region("auto")` \[7\]. Fs and memory are one-liners (`Fs::default().root("/var/hub")`, `Memory::default()`).

### Backends

`opendal::services` lists 50+ backends including `s3`, `fs`, `memory`, `azblob`, `gcs`, `oss`, `obs`, `cos`, `b2`, `webdav`, `sftp`, `gdrive`, `dropbox`, `redis`, `rocksdb`, `postgresql`, `mysql` \[8\]. **All Doc-Hub adapters (fs, memory, S3, MinIO, R2, B2) are first-class.** We deliberately expose only the object-store + local set; the hub does not want KV or remote-Drive backends as document stores.

### Streaming reads and writes

`Reader`/`Writer` are zero-copy on top of `bytes::Bytes` \[9\]:

```rust
// Bytes stream (range supported)
let s = op.reader("file").await?.into_bytes_stream(0..1_048_576).await?;
let chunks: Vec<bytes::Bytes> = s.try_collect().await?;

// futures::AsyncRead bridge — drop straight into hyper/tower body types
let mut r = op.reader("file").await?.into_futures_async_read(..).await?;

// Sink a stream into a writer (multipart S3, single-file fs)
let mut w = op.writer_with("upload").await?;
w.sink(upload_stream).await?;
w.close().await?;
```

Bridges cleanly to Axum's `Body::from_stream`. Same code path works for fs (temp-file + atomic rename) and S3 (multipart, 5 MiB min chunk per AWS) \[10\].

### Signed URLs

`Operator::presign_read(path, ttl)` and `presign_write(path, ttl)` return a `PresignedRequest` with method, URL, headers \[11\]. For S3 these are Sigv4 query strings (`X-Amz-Algorithm=AWS4-HMAC-SHA256`, `X-Amz-Expires`, `X-Amz-Signature`).

### Listing, metadata, copy, rename, stat, delete

All on `Operator` \[5\], \[12\]:

```rust
op.write("a", "hi").await?;
op.copy("a", "b").await?;
op.rename("a", "c").await?;
let meta = op.stat("c").await?;        // content-length, content-type, last-modified, etag, mode
op.delete("c").await?;
let entries = op.list("dir/").await?;  // returns Vec<Entry>
```

`list` is lazily paginated when the backend supports continuation tokens. Metadata is a typed struct; what each backend populates is declared by `Capability` (see §4). `Metakey` was removed in RFC-5313 — services return what they cheaply can, call `stat` for the rest \[13\].

### Maintenance & users

Weekly commits, monthly releases, full PMC. Production users: **Databend, GreptimeDB, RisingWave, Quickwit, Lance, sccache, SeaTunnel, Vector, QuestDB, CrateDB, SlateDB, Spice.ai, Vaultwarden, Dify, RAGFlow, LlamaIndex** \[14\].

## 1a. The mandatory encryption layer (sits above OpenDAL)

OpenDAL is the plaintext-agnostic transport. Doc-Hub wraps it so **no plaintext document bytes ever reach a backend** — the non-negotiable rule from `CLAUDE.md`. The facade is the only thing that talks to the `Operator`, and it always seals on the way in / opens on the way out:

```
write(key, plaintext)  →  dochub-crypto.seal(workspace_dek, plaintext)  →  operator.write(key, ciphertext)
read(key)              →  operator.read(key)  →  dochub-crypto.open(workspace_dek, ciphertext)  →  plaintext
```

- **Envelope encryption.** Each workspace has a Data Encryption Key (DEK). The DEK is wrapped by a master Key Encryption Key (KEK) from `DOCHUB_MASTER_KEY` or an external KMS; only wrapped DEKs are persisted. Primitive: AES-256-GCM (`ring`/`aws-lc-rs`), random 96-bit nonce per blob, stored as `nonce ‖ ciphertext ‖ tag`. Same envelope scheme seals BYO-bucket credentials (`08-byo-storage.md`).
- **No plaintext at rest — enforced two ways.** By construction (handlers hold `Arc<Storage>` / `Arc<StorageRegistry>`, never `opendal::Operator`, so they *cannot* reach the raw operator) and by test (a spy backend asserts every byte it receives is ciphertext, and `open(seal(x)) == x` for all `x`).
- **Opaque ULID keys.** Storage keys are `ulid::Ulid::new()`, never derived from filename or user input — no path-traversal or key-guessing surface. Human-facing names live only in the DB.
- **Write-once, content-addressed versions.** Each committed version is a new write-once blob; the immutable version engine records `content_hash = SHA-256(ciphertext)` and `prev_hash`. The facade never overwrites a committed blob; "delete" is a tombstone under retention/legal-hold, never an `operator.delete` of held bytes.
- **Key rotation is blob-free.** Rotating the KEK re-wraps DEKs; document blobs are not rewritten. Explicit workspace re-key is the only path that re-encrypts blobs.

This is a `Layer`-shaped concern but we keep it in the facade rather than an `opendal::Layer`, because seal/open needs the per-workspace DEK (resolved from `StorageRegistry`, `08-byo-storage.md`), which an operator-level layer doesn't have in scope.

## 2. `object_store` (Apache Arrow)

Originally InfluxData's, donated to Apache Arrow, now in `apache/arrow-rs-object-store` (latest 0.13.2) \[15\], \[16\]. Apache-2.0/MIT.

One `ObjectStore` trait: `put_opts`, `put_multipart_opts` (returns `Box<dyn MultipartUpload>`), `get_opts` (returns a streamable/rangeable `GetResult`), `delete`, `delete_stream`, `list`, `copy`, `rename` \[17\]. Backends: **S3, GCS, Azure Blob, HTTP/WebDAV, in-memory, local file** \[16\]. MinIO via S3 with custom endpoint.

vs OpenDAL:

- **Narrower backends** — object stores + local fs; no SFTP/HDFS/Drive/KV. Bridge crate `object_store_opendal` lets you borrow OpenDAL's extras \[18\].
- **Signed URLs**: not portable on the trait. Tracked as `apache/arrow-rs#3027`; partial S3 landed, Azure/GCP open \[19\]. Matters for us (direct-to-storage upload, `10-direct-upload.md`).
- **Large multipart S3 throughput** is historically better than OpenDAL — acknowledged upstream \[20\].
- **No `Layer` system.** Retry/throttle/metrics are BYO.

Net: leaner and faster on bulk S3, fewer backends, no portable signed-URL story.

## 3. Hand-Rolled Adapter Trait

Async pattern: **`async_trait` macro**, not native AFIT — native `async fn` in traits is **not object-safe** as of 2026, and we need `Arc<dyn Storage>` in Axum `AppState` \[21\]. Cost: one heap allocation per call, negligible against I/O.

```rust
use async_trait::async_trait;
use bytes::Bytes;
use futures::stream::BoxStream;

#[derive(Debug, Clone)]
pub struct ObjectMeta {
    pub key: String, pub size: u64,
    pub etag: Option<String>, pub last_modified: Option<time::OffsetDateTime>,
    pub content_type: Option<String>,
}
pub struct ListPage { pub entries: Vec<ObjectMeta>, pub next_token: Option<String> }
pub enum SignedUrl {
    Native(url::Url),                              // S3/MinIO presign
    Token { token: String, expires_at: i64 },     // fs/memory HMAC, served at /raw/{token} on the user-content origin
}

#[async_trait]
pub trait Storage: Send + Sync + 'static {
    async fn put(&self, key: &str, body: BoxStream<'static, Result<Bytes, StorageError>>)
        -> Result<ObjectMeta, StorageError>;
    async fn get(&self, key: &str, range: Option<std::ops::Range<u64>>)
        -> Result<BoxStream<'static, Result<Bytes, StorageError>>, StorageError>;
    async fn stat(&self, key: &str) -> Result<ObjectMeta, StorageError>;
    async fn delete(&self, key: &str) -> Result<(), StorageError>;
    async fn copy(&self, src: &str, dst: &str) -> Result<(), StorageError>;
    async fn rename(&self, src: &str, dst: &str) -> Result<(), StorageError>;
    async fn list(&self, prefix: &str, token: Option<&str>) -> Result<ListPage, StorageError>;
    async fn signed_get(&self, key: &str, ttl: std::time::Duration) -> Result<SignedUrl, StorageError>;
    async fn signed_put(&self, key: &str, ttl: std::time::Duration) -> Result<SignedUrl, StorageError>;
}
```

Trait surface is small. Hidden cost is the four impls: S3 multipart (≥5 MiB chunks \[10\]), fs atomic-rename-on-close, MinIO endpoint quirks, per-backend error mapping, range syntax, etag synthesis for fs. Exactly what OpenDAL already did.

## 4. Comparison Matrix

| Axis | OpenDAL-on-top | `object_store` | Hand-rolled |
|---|---|---|---|
| **Lines of code we write** | ~80–150 (thin facade + token shim) | ~200–300 (facade + signed-URL shim covering Azure/GCP gaps + fs/memory) | ~1.5–3k (trait + 4 impls + tests) |
| **Backends supported out of the box** | 50+ \[8\] | ~6 (S3, GCS, Azure, HTTP, fs, memory) \[16\] | 4 (the ones we wrote) |
| **Adding Azure / B2 later** | Swap the `Builder`; ~10 LoC | First-party for Azure, B2 needs us | Write a new ~500-LoC adapter |
| **Dependency cost** | `opendal` (one crate, optional service features behind cargo flags) | `object_store` (slim) | None beyond what we'd already pull |
| **Signed URLs** | Built-in `presign_read`/`presign_write` for S3/MinIO; `Capability::presign_read` flag lets us fall back to our HMAC token for fs/memory \[11\], \[22\] | Partial — tracked as open work, no portable trait method as of 0.13 \[19\] | We implement everywhere |
| **Retry / metrics / tracing** | `Layer` stack \[6\] | Bring your own | Write our own |
| **Streaming** | `Reader`/`Writer` + `futures::AsyncRead` and `Stream` adapters \[9\] | `GetResult` stream + `MultipartUpload` trait \[17\] | We thread `Stream<Item = Bytes>` manually |
| **Large-S3-upload throughput** | Slightly behind `object_store` \[20\] | Best-in-class \[20\] | Depends on us |
| **Capability gaps (presign on fs)** | Surface via typed `Capability` struct, ask before calling | Ad hoc — we'd `match` on backend | Our enum |
| **Governance / license** | Apache TLP, Apache-2.0 \[1\] | Apache TLP, Apache-2.0/MIT \[16\] | Ours |

Capability gaps are the decisive structural point. OpenDAL exposes `op.info().full_capability()` with typed booleans (`presign_read`, `copy`, `rename`, `list`, `write_can_append`) \[22\], so the facade is one branch:

```rust
if op.info().full_capability().presign_read {
    SignedUrl::Native(op.presign_read(key, ttl).await?.uri().parse()?)
} else {
    SignedUrl::Token(mint_hmac_token(key, ttl, Method::Get))
}
```

Hand-rolled, we'd reinvent the same enum.

## 5. Signed-URL Story Per Backend

**S3** — Sigv4 query string (`X-Amz-Algorithm=AWS4-HMAC-SHA256`, `X-Amz-Credential`, `X-Amz-Date`, `X-Amz-Expires`, `X-Amz-SignedHeaders`, `X-Amz-Signature`). IAM users sign up to 7 days; STS/role credentials capped by session lifetime. Expiry checked at request start, not completion. PUT, GET, HEAD \[23\], \[24\].

**MinIO** — same Sigv4 wire format. Min 1 s, default/max 7 d (604 800 s) \[25\]. OpenDAL's `S3` builder with custom `endpoint` and `region("auto")` is the canonical wiring \[7\].

**Filesystem** — no native equivalent. Doc-Hub mints its own token:

```
token = base64url( payload || hmac_sha256(secret, payload) )
payload = "GET\n{key}\n{exp_unix}"
```

`GET /raw/{token}` decodes, splits, recomputes HMAC (constant-time compare), checks expiry, then streams via `op.reader(key).into_futures_async_read(..)`. Same handler accepts uploads when method is `PUT`. Stack: `hmac` + `sha2` + `base64` + `subtle::ConstantTimeEq` — standard Axum webhook-signature pattern \[26\].

**Memory** — identical to filesystem; same token format, same handler, in-memory `Operator`.

**Facade**: handlers call `storage.signed_get(key, ttl).await?` and get `SignedUrl::Native(url)` (S3/MinIO — redirect or JSON) or `SignedUrl::Token { url, .. }` (fs/memory — points at our `/raw/{token}`). Clients don't know which backend they hit.

## 6. Conformance Test Pattern

One suite, all four backends. `rstest` for parameterisation \[27\]; `testcontainers-modules` with the `minio` feature for MinIO \[28\].

```rust
// tests/storage_conformance.rs
use rstest::*;
use testcontainers_modules::{minio, testcontainers::runners::AsyncRunner};

async fn minio_op() -> (opendal::Operator, MinioGuard) {
    let node = minio::MinIO::default().start().await.unwrap();
    let port = node.get_host_port_ipv4(9000).await.unwrap();
    let b = opendal::services::S3::default()
        .endpoint(&format!("http://127.0.0.1:{port}"))
        .region("auto").bucket("test")
        .access_key_id("minioadmin").secret_access_key("minioadmin");
    (opendal::Operator::new(b).unwrap().finish(), MinioGuard(node))
}

#[rstest]
#[case::fs(Backend::Fs)] #[case::mem(Backend::Mem)] #[case::minio(Backend::Minio)]
// #[case::s3(Backend::S3)]   // gated on AWS_TEST_BUCKET
#[tokio::test]
async fn put_get_roundtrip(#[case] b: Backend) {
    let op = make_op(b).await;
    op.write("k", "hello").await.unwrap();
    assert_eq!(op.read("k").await.unwrap().to_vec(), b"hello");
}

#[rstest]
#[case::minio(Backend::Minio)]   // backends with capability.presign_read
#[tokio::test]
async fn native_presign_round_trips(#[case] b: Backend) {
    let op = make_op(b).await;
    assert!(op.info().full_capability().presign_read);
    let req = op.presign_read("k", Duration::from_secs(60)).await.unwrap();
    // hit req.uri() with reqwest, expect 200
}
```

The same cases run against our `Storage` facade, asserting `signed_get` returns the right `SignedUrl` variant and both code paths serve bytes. One extra case is non-negotiable: a **spy backend** wraps the operator and asserts every byte written is ciphertext (`seal` ran) and `open(seal(x)) == x` for all `x` (proptest). This is Testing invariant #1, "No plaintext at rest."

## 7. Path / Key Model

Unix-style. OpenDAL auto-normalises per RFC-0112 \[29\]: `//` collapses to `/`; leading slash optional (`"/abc"` == `"abc"`); absolute backend path is `{root}/{path}`. We adopt verbatim as Doc-Hub's contract, but keys are **opaque ULIDs** minted server-side, not user paths: slash-separated, leading slash optional, no `.`/`..`, no Windows `\`. `Key` is a `String` normalised at the API boundary; it never carries a filename.

## 8. Metadata, Mtime, Etags, Content-Types

Per OpenDAL's `Capability` and `Metadata` \[13\], \[22\]:

| Field | S3 / MinIO | Filesystem | Memory |
|---|---|---|---|
| `content_length` | Yes | Yes (`stat`) | Yes |
| `last_modified` | Yes (Sigv4 header) | Yes (`mtime`) | Yes (we set on write) |
| `etag` | Yes (MD5 for single-part, opaque for multipart) | **No** — synthesise from `sha256(path||mtime||size)` or `xxhash(content)` if cheap | **No** — synthesise on write |
| `content_type` | Yes (set on PUT) | **No** native; sniff via `infer` crate from extension or first 8 KiB | We carry it on the in-memory record |
| `version_id` | Optional (versioned buckets) | No | No |

Doc-Hub's `ObjectMeta` always carries `etag` and `content_type`; the facade synthesises what the backend doesn't. Note `content_type` here describes the *ciphertext* blob (opaque octet-stream at rest); the document's real MIME lives in the DB `files` row, set by the allowlisted, magic-byte-sniffed ingest. S3/MinIO: trust the header. Fs: sidecar JSON or xattr written alongside the bytes. Memory: `HashMap<String, ObjectMeta>` parallel to the byte store.

## 9. Recommendation

**Build on OpenDAL.** Wrap it in a Doc-Hub-specific facade that hides `Operator` and, critically, hosts the mandatory seal/open encryption layer (§1a).

Reasons in order of weight:

1. **All four adapters first-class, one line each.** Fs, memory, S3, MinIO all in `opendal::services`.
2. **`Capability` is the right shape for our presign gap** — same enum we'd otherwise reinvent.
3. **Layers give retry/metrics/tracing for free.**
4. **Apache TLP, monthly releases, deep user list** (Databend, GreptimeDB, RisingWave, Lance, Vector, Quickwit). Bus factor fine.
5. **Adding Azure/B2/GCS later** is `services::Azblob::default()`, not a new 500-LoC adapter.

Tradeoffs we accept:

- OpenDAL is slower than `object_store` on big multipart S3 throughput \[20\]. Doc-Hub stores documents (docx/xlsx/pdf/md/txt/csv/json/yaml), not media — files are small and not bottlenecked. If it changes, the facade lets us swap S3 specifically to `object_store` without touching handlers or the encryption layer.
- 50+ services we don't need — mitigated by `default-features = false, features = ["services-s3", "services-fs", "services-memory"]`.
- v0.54 churn (RFC-5313 removed `Metakey`, RFC-6189 removed blocking, RFC-6213 added options APIs) \[3\] — pin exact version, audit `docs/upgrade` on bump.

### What this implies in code

```rust
// crates/dochub-storage/src/lib.rs
#[derive(Clone)]
pub struct Storage {
    op: opendal::Operator,
    crypto: Arc<dochub_crypto::Envelope>, // per-workspace DEK seal/open — the encryption boundary
    sign_key: Arc<[u8; 32]>,             // HMAC secret for self-minted tokens
    raw_base: Arc<str>,                  // base URL of the /raw/{token} mount (user-content origin)
}

pub enum SignedUrl { Native(url::Url), Token { url: url::Url, expires_at: i64 } }

impl Storage {
    pub fn from_env() -> anyhow::Result<Self> { /* pick s3/fs/memory/minio/r2/b2 per DOCHUB_STORAGE_BACKEND; refuse to boot without a master key */ }
    // Every write seals; every read opens. Handlers cannot bypass this — they never see `op`.
    pub async fn put_stream(&self, key: &str, body: BodyStream)  -> anyhow::Result<ObjectMeta> { /* seal → op.writer_with(key).sink(ciphertext) — write-once, opaque ULID key */ }
    pub async fn get_stream(&self, key: &str, range: Option<Range<u64>>) -> anyhow::Result<BodyStream> { /* op.reader(..).into_bytes_stream(range) → open */ }
    pub async fn stat(&self, key: &str)   -> anyhow::Result<ObjectMeta> { /* op.stat */ }
    pub async fn delete(&self, key: &str) -> anyhow::Result<()> { /* op.delete */ }
    pub async fn copy(&self, s: &str, d: &str)   -> anyhow::Result<()> { /* op.copy */ }
    pub async fn rename(&self, s: &str, d: &str) -> anyhow::Result<()> { /* op.rename */ }
    pub async fn list(&self, prefix: &str, t: Option<&str>) -> anyhow::Result<ListPage> { /* op.list */ }

    pub async fn signed_get(&self, key: &str, ttl: Duration) -> anyhow::Result<SignedUrl> {
        if self.op.info().full_capability().presign_read {
            Ok(SignedUrl::Native(self.op.presign_read(key, ttl).await?.uri().to_string().parse()?))
        } else {
            Ok(self.mint_token(key, ttl, http::Method::GET))
        }
    }
    pub async fn signed_put(&self, key: &str, ttl: Duration) -> anyhow::Result<SignedUrl> { /* mirror */ }
    fn mint_token(&self, key: &str, ttl: Duration, m: http::Method) -> SignedUrl { /* HMAC */ }
}
```

Handlers depend only on `Arc<Storage>` (or `Arc<StorageRegistry>` once BYO-bucket lands, `08-byo-storage.md`). Backend is a construction-time choice; **the encryption layer is not a choice** — it is inside every read/write. The `/raw/{token}` route is always mounted on the user-content origin — the handler verifies HMAC, opens the ciphertext, and streams plaintext (never exposing the blob at rest).

That is the entire abstraction layer: OpenDAL for transport, a thin facade for the seal/open encryption boundary, opaque ULID keys, write-once blobs. Build it and stop.

## Sources

1. [Apache OpenDAL is now Graduated](https://opendal.apache.org/blog/apache-opendal-graduated/)
2. [A Recap of Apache OpenDAL becoming TLP — tisonkun.com](https://www.tisonkun.com/blog/a-recap-of-apache-opendal-becoming-tlp)
3. [opendal::docs::changelog (latest)](https://docs.rs/opendal/latest/opendal/docs/changelog/index.html)
4. [Operator — opendal docs](https://opendal.apache.org/docs/rust/opendal/struct.Operator.html)
5. [opendal crate root docs](https://opendal.apache.org/docs/rust/opendal/)
6. [OperatorBuilder — opendal docs](https://opendal.apache.org/docs/rust/opendal/struct.OperatorBuilder.html)
7. [S3 service builder — opendal docs](https://opendal.apache.org/docs/rust/opendal/services/struct.S3.html)
8. [opendal::services index](https://docs.rs/opendal/latest/opendal/services/index.html)
9. [Reader — opendal docs](https://opendal.apache.org/docs/rust/opendal/struct.Reader.html)
10. [Performance Issue: opendal slower than object_store for Large File Uploads to S3 — apache/opendal#5929](https://github.com/apache/opendal/issues/5929)
11. [Operator presign_read/presign_write usage notes](https://nightlies.apache.org/opendal/opendal-docs-release-v0.47.0/docs/services/s3/)
12. [Operator copy/rename/stat/delete — opendal docs](https://opendal.apache.org/docs/rust/opendal/struct.Operator.html)
13. [RFC-5313 Remove Metakey — opendal commits archive](https://www.mail-archive.com/commits@opendal.apache.org/msg25806.html)
14. [Apache OpenDAL 2025 Roadmap: Perfecting Production Adoption](https://opendal.apache.org/blog/2025/03/01/2025-roadmap/)
15. [object_store on crates.io](https://crates.io/crates/object_store)
16. [object_store crate root — docs.rs](https://docs.rs/object_store/latest/object_store/)
17. [ObjectStore trait — docs.rs](https://docs.rs/object_store/latest/object_store/trait.ObjectStore.html)
18. [object_store_opendal — bridge crate](https://lib.rs/crates/object_store_opendal)
19. [object_store: Support signed URLs — apache/arrow-rs#3027](https://github.com/apache/arrow-rs/issues/3027)
20. [Reducing S3 API Calls by 98% — OpenDAL RangeReader (Greptime)](https://greptime.com/blogs/2024-01-04-opendal)
21. [Announcing async fn and return-position impl Trait in traits — Rust Blog](https://blog.rust-lang.org/2023/12/21/async-fn-rpit-in-traits/)
22. [Capability — opendal docs](https://opendal.apache.org/docs/rust/opendal/struct.Capability.html)
23. [Download and upload objects with presigned URLs — AWS S3 docs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)
24. [Specifying the Signature Version in request authentication — AWS S3 docs](https://docs.aws.amazon.com/AmazonS3/latest/API/specify-signature-version.html)
25. [Presigned URLs — minio-go DeepWiki](https://deepwiki.com/minio/minio-go/5.2-presigned-operations)
26. [Implementing GitHub Webhooks in Rust With Axum — pg3.dev](https://pg3.dev/post/github_webhooks_rust)
27. [rstest — fixture-based test framework for Rust](https://github.com/la10736/rstest)
28. [testcontainers-modules MinIO — docs.rs](https://docs.rs/testcontainers-modules/latest/testcontainers_modules/minio/struct.MinIO.html)
29. [RFC-0112 Path Normalization — opendal docs](https://opendal.incubator.apache.org/docs/rust/opendal/docs/rfcs/rfc_0112_path_normalization/index.html)
