# Phase 3 — Build Spec

Implementation-level target for **Phase 3 — content search + AI layer**. Read with [`phase-2-build.md`](./phase-2-build.md), [`../ARCHITECTURE.md`](../ARCHITECTURE.md) (§"Content indexing", §"AI layer"), [`../../PLAN.md`](../../PLAN.md) (Phase 3), and [`../TESTING.md`](../TESTING.md).

**Phase 3 goal:** answer *"which document mentions X?"* over document **content** (not just names), then reason over it — semantic search, summaries, PII detection, cross-document Q&A. This is where the server-trusted encryption model pays off: because the server can decrypt, it can index and reason.

**Depends on Phase 0–1** (merged): the encrypted version engine (`Registry`), `file_versions`, audit. New crates `dochub-index` and `dochub-ai` (stubs may exist from the rename). External: the Rust **`core`** document engine (extraction), an embeddings/LLM provider.

**Non-goals (Phase 3):** using semantic search *alone* for compliance-critical retrieval (Tantivy exact/full-text stays primary), AI that mutates documents or history (AI is read-only + audited), training on user data.

---

## 1. Content indexing (`dochub-index` + `core`)

### Extraction (`core`)
`core` (vendored) extracts normalized text per format: `docx` (runs/headers/footers/tables/textboxes), `xlsx` (cells/comments/sheet names), `pdf` (text layer; OCR fallback later), `md/txt/csv/json/yaml` (raw/structured). One `core::extract(kind, bytes) -> Text` entry point; `dochub-index` never re-implements parsing.

### Index (`dochub-index`, Tantivy)
- Fields: `file_id, workspace_id, seq(head), title, extension, content, author, tags, created_at, modified_at, content_hash`.
- **Worker:** a lazy background worker mirroring the retired thumbnail-worker pattern. A `files.index_state` column (`pending|ready|unsupported|failed`) drives it: on new committed version → `pending`; the worker decrypts the head, `core::extract`s, writes the Tantivy doc, sets `ready`. Bounded concurrency; single-writer or shared-index for multi-replica (see `research/16-scale-infra.md`).
- **Lifecycle:** reindex on every new version (index the head only; history is retrievable but not all indexed in P3); **remove from index on tombstone**; respect legal-hold (held docs stay indexed for discovery unless workspace policy says otherwise — decision D2).
- No plaintext persisted by the index beyond the Tantivy store (which lives inside the trusted server; document it in the security brief — the index is as sensitive as the plaintext and must be access-controlled + ideally on encrypted storage).

**Acceptance:** a phrase inside a `.docx`/`.pdf`/`.xlsx` is found by content (e2e UC-6); reindex on new version; index entry gone after tombstone.

## 2. Search API + surface (`dochub-http` + `web/`)

- `GET /api/search?q=&type=&project=&before=&after=&hold=` → union of Tantivy content hits + SQL metadata, workspace-scoped + permission-filtered, cursor-paginated. Each result: `{file_id, title, kind, project, snippet(highlighted), matched_seq, modified_at, badges:[encrypted, hold?, tamper?]}`.
- Query operators (from `research/05` / `ux/12`): bare terms, `"phrase"`, `type:pdf`, `ext:docx`, `tag:x`, `author:x`, `before:/after:`, `contains:email|phone`.
- **UI:** the existing search box (⌘-K + top bar) upgrades from name-match to **content search** — snippet + highlight + matched-page/sheet, dense results per ui-system. The M2 search perf instrumentation stays.

**Acceptance:** searching a phrase that exists only *inside* a document returns it with a snippet (UC-6).

## 3. AI layer (`dochub-ai`) — optional, read-only, audited

`dochub-ai` sits beside search, never replacing it for compliance-critical retrieval.

- **Provider abstraction:** `trait AiProvider { embed(texts) -> Vec<Embedding>; complete(prompt, tools?) -> Completion; }`. Default = **Claude via the Anthropic API** (Haiku for extraction/classification/PII, Sonnet/Opus for Q&A/summaries); a **local-model adapter** for air-gapped installs. Config `DOCHUB_AI_PROVIDER`, `DOCHUB_AI_API_KEY`, model ids. Disabled by default.
- **Semantic search:** embed content chunks → a vector index (Tantivy KNN or a sidecar) → **rerank alongside** the Tantivy full-text results; never the sole retrieval for compliance.
- **Summaries:** per-document / per-section, on demand, cached by `content_hash`.
- **Entity + PII detection:** provider (or rules) flags person/email/phone/ID/etc. as **suggestions** surfaced in the compliance UI; a human approves any action (e.g. a future redaction). Never auto-redacts.
- **Cross-document Q&A:** retrieve (Tantivy + semantic) → ground the answer with **citations** (file_id + snippet); refuse to answer beyond retrieved context.
- **Guardrails:** AI is **read-only** — it never mutates documents, versions, or history. Every AI invocation is audited (`ai.query`, `ai.summary`, `ai.pii_scan`) with the model + token count. Prompts never include another workspace's content (tenant isolation). Rate-limit + circuit-break the provider.

**Acceptance:** a semantic query surfaces a relevant doc a keyword query misses; PII detection flags known fixtures; every AI action is read-only + audited (UC-10).

## 4. Test matrix (maps to `docs/TESTING.md`)

| Invariant / UC | Where |
|---|---|
| UC-6 content search finds inside-doc text | `dochub-index`/`http` integration + e2e |
| reindex on version / remove on tombstone | `dochub-index` integration |
| index has no cross-workspace leakage | `dochub-http` search authz tests |
| UC-10 AI read-only + audited, PII flagged | `dochub-ai` integration (mock provider) + audit assertions |
| semantic never sole for compliance retrieval | rerank test: Tantivy hits always present |

`fmt`/`clippy -Dwarnings`/`test`/`cargo deny` green; coverage ≥85%. AI provider tests use a **mock provider** (no network in CI).

## 5. PR sequence

1. **P3.1** `core` extraction integration + `dochub-index` (Tantivy) + the index worker + `index_state`.
2. **P3.2** `GET /api/search` content search + operators + the UI upgrade to content results.
3. **P3.3** `dochub-ai` provider abstraction + mock provider + audit + config (no real calls in CI).
4. **P3.4** Semantic search (embeddings + rerank).
5. **P3.5** Summaries + PII detection (suggestions).
6. **P3.6** Cross-document Q&A with citations.

## 6. Decisions

- **D1 — Vector store:** Tantivy KNN vs. a dedicated store (qdrant/lance). *Recommendation:* start with Tantivy/`core`-adjacent to avoid a new service; revisit at scale.
- **D2 — Index under legal hold:** keep held docs searchable (discovery) vs. hide. *Recommendation:* keep searchable for admins (legal hold is *about* discovery); respect per-result permission filtering.
- **D3 — Default AI provider on/off:** off by default (privacy) with explicit opt-in + a clear "content is sent to <provider>" consent; local-model path documented for air-gapped.
- **D4 — Index-at-rest encryption:** the Tantivy store is as sensitive as plaintext — put it on the encrypted storage backend or an encrypted volume; confirm before P3.1.
