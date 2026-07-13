# Doc-Hub — Capability Build Tracker

> Deep, per-capability build plan for the Drive → **encrypted, tamper-evident document registry** revamp.
> Complements [`PIPELINE.md`](../PIPELINE.md) (phase-level status) and [`PLAN.md`](../PLAN.md) (phase scope) with a **capability-by-capability pipeline**: goal, milestone checklist, acceptance tests, and dependencies for each.
> **Current phase: Phase 0.** Nothing after Phase 2 starts until each predecessor's acceptance tests are green.

**Status legend:** `Shipped` (merged + tested on `main`) · `Partial` (real code, incomplete) · `In progress` (active this phase) · `Design-only` (spec exists, no code) · `Not-started` (nothing yet).

> **Update (2026-07):** the AI/agentic backbone has since shipped and the TL;DR below is superseded — `dochub-ai`, `dochub-mcp`, and `dochub-worker` exist and are tested. Landed since this tracker was written: the durable job queue + worker, Office/PDF text extraction, search-by-tag, semantic search + RAG (`ask`), the **agentic** ReAct research loop (`/api/agent/ask` + MCP `research`), the MCP endpoint with bearer-PAT auth, per-user AI rate limiting, hash-chained audit + Activity UI, and Postgres portability in CI. See the status matrix (§2, refreshed) and the operator guide [`AI-MCP.md`](./AI-MCP.md). The narrative in §1 is kept for historical provenance.

**Provenance of this tracker:** statuses below were reconstructed by directly reading the workspace (`Cargo.toml`, `crates/*`, `web/package.json`, `PIPELINE.md`) plus the one capability audit that completed cleanly (content-search). A multi-agent audit was attempted but most agents were blocked by a macOS TCC / Full-Disk-Access denial on `~/Desktop` (they returned "could not read the code"); those verdicts were discarded and replaced with direct reads. Items I could not open are marked _(unverified)_.

---

## 1. TL;DR

The **inherited Drive spine is shipped and solid** (storage facade, portable migrations, append-only audit log, projects/roles/invites, Argon2id+OIDC auth, share links, two-origin model, AES-GCM secret-envelope) and **RBAC/ACLs landed recently** (`dochub-authz`, PR #85). The **registry foundations are mid-flight** (Phase 0: rename, documents-only allowlist, `dochub-crypto` document-byte envelope, hash-chain version engine). The big surprise: **full-text content search is further along than `PIPELINE.md` says** — `dochub-index` (Tantivy 0.26) and `GET /api/search/content` are built **and tested**, and are already **wired into the SPA** (Command Palette + Files search run content search in parallel with metadata search, rendering highlighted `SearchSnippet`s). The real remaining search gap is **Office/PDF text extraction** — today only text formats (md/txt/csv/json/yaml) are extracted; `.docx/.xlsx/.pdf` index title+extension only. Everything the founder asked to "build properly" — **search-by-tag, RAG, MCP, an agentic pipeline, a durable job runner, a real frontend state layer (Redux), and shared UI primitives** — is **not-started or design-only** (there are no `dochub-ai`, `dochub-mcp`, or worker crates). **Recommended start:** finish Phase 0's hash-chain/crypto gate, then land the **extraction + background worker** half of the indexing backbone (search is already end-to-end for text formats), because RAG, MCP, and search-by-tag all build on it.

---

## 2. Status matrix

| Capability | Status | What exists (verified) | What's missing | Effort |
|---|---|---|---|---|
| Storage / DB spine | **Shipped** | `dochub-storage` (OpenDAL facade), `dochub-db` portable migrations | — | — |
| Auth (Argon2id, sessions, OIDC) | **Shipped** | `dochub-auth`; `__Host-` cookie; PKCE | Multi-IdP federation (deferred) | — |
| RBAC + ACLs + projects | **Shipped** | `dochub-authz` (Owner/Admin/Member, per-resource ACLs), enforced (PR #85) | Enforcement-coverage audit across every route _(unverified)_ | S |
| Audit log | **Shipped (append-only, hash-chained)** | append-only `audit_log` (SP3), SHA-256 hash-chained (`prev_hash`/`entry_hash` + `verify_audit_chain`); Activity feed UI; token lifecycle events (PR #141/#143) | Full emit-coverage audit across every route | S |
| Encryption at rest | **In progress** | `dochub-crypto` AES-256-GCM secret-envelope (SP8, shipped for BYO creds) | Generalize envelope to **document bytes** + per-workspace DEK; boot-refuses-without-key (P0-3) | M |
| Provenance / hash-chain (“prove things”) | **In progress** | version engine + `dochub-crypto` scaffolding | `content_hash`/`prev_hash`, write-once blobs, `verify_chain`, restore-as-new, chained audit (P0-4) | L |
| Documents-only ingest | **In progress** | allowlist scaffolding | Extension **+ magic-byte sniff** on every path; reject test (P0-2) | S |
| Indexing + extraction (Rust) | **Partial** | `dochub-index` (Tantivy 0.26, tests); `index_state`/`indexed_hash`; lazy reindex-on-query | **Office/PDF extraction** (only md/txt/csv/json/yaml today); a true **background worker**; extraction via `core` | L |
| Full-text / global search | **Partial** | `GET /api/search` (metadata, shipped + UI-wired, 20+ tests); `GET /api/search/content` (BM25 + `<b>` snippets, **7 unit + 6 integ tests**); **SPA-wired** — `searchContent` in `CommandPalette.tsx` + `Files.tsx` with `SearchSnippet` | Office/PDF content coverage (extraction gap); filters/facets on content results | S–M |
| Search by tag | **Not-started** | — (no tag tables/routes found) | Tag model + `document_tags` migration, tag CRUD endpoints, tag filter in search, tag UI | M |
| Vaults | **Partial** | projects/workspaces (SP4) as the container | Explicit **Vault** UX + per-vault DEK boundary story, vault switcher/grid in SPA | M |
| RAG / AI layer | **Shipped** | `dochub-ai` (chunk → embed → cosine top-k → answer); offline `LocalEmbedder` + `ExtractiveAnswerer`; provider-agnostic `RemoteAnswerer` (Claude / OpenAI / local via `DOCHUB_AI_PROVIDER`); `GET /api/search/semantic` + `POST /api/search/ask`; SPA Answer panel. Per-user rate limiting (PR #142). Guide: [`AI-MCP.md`](./AI-MCP.md) | Summaries / entity + PII detection (deferred) | M |
| MCP integration | **Shipped** | `dochub-mcp` JSON-RPC 2.0 core; `POST /api/mcp` with `semantic_search` / `ask` / `research` tools, permission-filtered; session **or** bearer-PAT auth (PR #139) | Streaming transport (SSE) | S |
| Agentic pipeline / job runner | **Shipped** | durable `jobs` queue + `dochub-worker` (poll + backoff); `index_file`/`embed_file` handlers; **agentic** ReAct research loop (`dochub_ai::Agent`), `POST /api/agent/ask` + MCP `research`, SPA Research panel (PR #137/#138) | Broader agent tool surface (versions/provenance actions) | M |
| Frontend state (Redux etc.) | **Not-started (ad-hoc today)** | React 19 + Vite + Tailwind v4; `react-hook-form` + `zod` + `rxjs` + Context | A real state layer (**Redux Toolkit** or Zustand) + typed API client + server-cache (RTK Query) + error boundaries | L |
| UX / UI polish | **Partial** | neobrutal `tokens.css`, domain primitives (StatusChip, RegistryMotif) | Shared `Button/Card/Input` primitives (inline styles today); loading/empty/error/skeleton states; a11y; mobile | L |
| Backend robustness | **Partial** | Axum handlers; `zod`-side validation on client; per-user rate limiting on uploads + AI endpoints (429 + `Retry-After`, PR #142); portable Postgres path (PR #133) tested in CI | Consistent error→status→JSON envelope audit; boot config validation; observability (metrics) | M |
| Notes editor | **Partial (bug)** | TipTap + `tiptap-markdown` + `marked` | **Bug:** pasted markdown not rendered until reload (see §5) | S |

---

## 3. Per-capability pipelines

### Indexing + text extraction — Partial
**Goal:** every committed document version's text is extracted and indexed (all allowed formats), kept fresh on new-version, and removed on tombstone — driven by a durable background worker.
- [ ] Add `core`-backed extraction for **docx / xlsx / pptx / pdf** in `dochub-index` (today only md/txt/csv/json/yaml decode as UTF-8).
- [ ] Replace lazy reindex-on-query with a **durable background worker** (mirror the retired thumb-worker) reading `index_state`.
- [ ] Reindex on new version; **remove from index on tombstone** (wire into the version/tombstone paths).
- [ ] Backfill job for existing documents; bound memory (decrypt head, stream).
- **Acceptance:** a phrase inside a `.docx`/`.pdf`/`.xlsx` is found by content (e2e); new version reindexes; tombstone removes (integration); property test: index never contains plaintext-at-rest artifacts.
- **Depends on:** Phase 0 crypto (decrypt-to-extract), `core` extraction crate.

### Search / full-text + global — Partial
**Goal:** a single search surface answering "which document mentions X" with snippets, highlights, and type/project/date filters, reachable from the SPA.
- [x] Content search **wired into the SPA** — `searchContent` runs in parallel with metadata search in `Files.tsx` and `CommandPalette.tsx`; `<b>` snippets rendered via `SearchSnippet`.
- [ ] Carry the existing filter set (type/project/date) onto content results / add content-result facets.
- [ ] Office/PDF content coverage (blocked on extraction — see Indexing).
- **Acceptance:** UI e2e: type a phrase inside a `.docx`, get a highlighted content snippet linking to the doc; filters narrow content hits.
- **Depends on:** Indexing (Office/PDF extraction for full coverage).

### Search by tag — Not-started
**Goal:** documents can carry tags/labels; users filter and search by tag.
- [ ] `tags` + `document_tags` migrations (`dochub-db`), workspace-scoped, unique per workspace.
- [ ] Tag CRUD + assign/unassign endpoints (`dochub-http`), ACL-guarded, audited.
- [ ] Tag facet in `/api/search` + `/api/search/content`.
- [ ] SPA: tag chips on documents, tag filter in search, tag manager.
- **Acceptance:** assign a tag → filter by it returns exactly the tagged docs (integration + e2e); tag change is audited.
- **Depends on:** Search surface.

### RAG / AI layer — Design-only
**Goal:** read-only, audited AI over documents — semantic search, summaries, entity/PII, cross-document Q&A; pluggable provider (default Claude).
- [ ] New crate `dochub-ai`; provider trait (default **Anthropic/Claude**: Haiku extract/classify, Sonnet/Opus reason; local-model option).
- [ ] Embeddings + vector store (alongside Tantivy, never replacing it for compliance retrieval); embed on index.
- [ ] Semantic search endpoint (rerank + hybrid with BM25).
- [ ] Summaries, entity/PII detection (suggestions, human-approved), cross-doc Q&A with citations.
- [ ] Every AI action **audited**; no document/history mutation.
- **Acceptance:** semantic query surfaces a doc keyword search misses; PII scan flags fixtures; provider swap stays green; zero mutations (property test).
- **Depends on:** Indexing + extraction; a job runner (for embed backfill).

### MCP integration — Design-only
**Goal:** an MCP server exposing Doc-Hub (search, read, versions, provenance) as tools/resources to external AI clients, respecting ACLs.
- [ ] New crate `dochub-mcp`; transport (stdio + HTTP), token-scoped auth reusing the session/ACL model.
- [ ] Tool surface: `search`, `read_document`, `list_versions`, `verify_chain`, `get_provenance` — all ACL-filtered + audited.
- [ ] Resource surface for document/version URIs.
- **Acceptance:** an MCP client lists tools, searches, and reads only what the caller's role permits (integration); every call audited.
- **Depends on:** Search + RAG tool surface; RBAC (done).

### Agentic pipeline / job runner — Not-started
**Goal:** a durable background-job runner, then read-only agentic workflows (plan→execute→review) over documents.
- [ ] Job/queue table + worker loop (tokio), retries, idempotency, `job_state` (foundation for indexing, embeds, reports).
- [ ] Migrate indexing + embeds onto it.
- [ ] Agent orchestration layer (read-only tools, audited, human-in-the-loop for suggestions).
- **Acceptance:** a killed worker resumes jobs without dupes (property/integration); an agent run mutates nothing and is fully audited.
- **Depends on:** none to start (job runner first); AI layer for the agent step.

### Provenance / hash-chain — In progress (Phase 0 P0-4)
**Goal:** every version immutable + hash-chained; tamper is detectable and provable; audit log itself chained.
- [ ] `file_versions` with `content_hash = SHA-256(ciphertext)` + `prev_hash`; write-once blobs.
- [ ] `verify_chain` recompute; restore-as-new (additive, destroys nothing).
- [ ] Hash-chain the `audit_log`.
- [ ] (Phase 1) offline-verifiable provenance export; (Phase 4) Ed25519 signing.
- **Acceptance (property tests):** N edits → N chained versions; tampering any stored version fails `verify_chain`; restore v*k* → v*N+1* byte-equal to *k*.
- **Depends on:** `dochub-crypto` (P0-3).

### Encryption & security — In progress (Phase 0 P0-3)
**Goal:** no plaintext document bytes ever reach a backend; per-workspace DEK wrapped by master KEK/KMS; boot refuses without a key.
- [ ] Generalize AES-GCM envelope from secrets to **document bytes** in the storage layer.
- [ ] Per-workspace DEK generate/wrap/unwrap; (Phase 1) KEK rotation without rewriting blobs; KMS adapter.
- [ ] Boot aborts without a master key.
- **Acceptance:** spy-backend integration test sees only ciphertext; boot-without-key aborts; post-rotation every doc still decrypts (property).
- **Depends on:** none.

### RBAC + audit logging — Shipped (RBAC) / In progress (chained audit)
**Goal:** every sensitive route ACL-guarded; every state change audited in an append-only, hash-chained log.
- [ ] _(verify)_ enforcement coverage: assert every mutating route in `dochub-http` passes an `authz` check.
- [ ] _(verify)_ audit-emit coverage: auth, upload, version, share, admin, permission-change all emit events.
- [ ] Chain the audit log (P0-4); surface an admin audit view + export.
- **Acceptance:** a permission-denied path is tested per route class; a state change without an audit row fails a coverage test.

### Vaults — Partial
**Goal:** first-class "Vault" containers (personal locker + team vaults) with a clear per-vault encryption boundary and a polished switcher.
- [ ] Decide Vault = workspace/project (SP4) vs a new layer; document the DEK-per-vault boundary.
- [ ] SPA vault switcher/grid (RegistryMotif), per-vault settings.
- **Acceptance:** creating a vault provisions its DEK; documents in vault A are unreadable with vault B's key (property).

### Frontend state (Redux) — Not-started (ad-hoc today)
**Goal:** a production data layer — predictable global state, typed API client, server-cache, consistent loading/error handling.
- [ ] Adopt **Redux Toolkit** (or Zustand) for app/session/UI state; migrate Context/rxjs usage.
- [ ] Typed API client with **RTK Query** (or React Query) for server cache, retries, invalidation.
- [ ] Centralize response handling + `zod` response validation; error boundaries + toast (`sonner`) on failures.
- **Acceptance:** unit tests for slices/selectors; an API error renders a handled state, never a blank screen (e2e).

### UX / UI polish — Partial
**Goal:** macOS-app-grade polish (Things 3 / Linear / Raycast) on the approved neobrutal system.
- [ ] Extract shared `Button / Card / Input / Pill / Dialog` primitives (retire copy-pasted inline styles).
- [ ] Loading / empty / error / skeleton states for every async surface.
- [ ] Keyboard + a11y pass; responsive/mobile; honor `prefers-reduced-motion`.
- **Acceptance:** the 10 polish commandments (`docs/research/04-polish-principles.md`) gate each surface; Playwright covers empty/error states.

### Backend robustness — Partial _(depth unverified)_
**Goal:** every request validated; one consistent error→status→JSON envelope; observable; rate-limited.
- [ ] Audit/enforce request validation (size/type/allowlist by ext + magic-byte).
- [ ] One error type → HTTP status → JSON envelope; never leak internals.
- [ ] Boot config validation; structured `tracing` + metrics; rate limiting on auth/upload/search.
- **Acceptance:** malformed/oversized/disallowed inputs rejected with typed errors (integration); a 500 leaks no internals (test).

---

## 4. Build-order tracks & dependency graph

```
Phase 0 (MUST be green first): rename · documents-only allowlist · dochub-crypto doc-byte envelope · hash-chain engine
        │
        ├─ Track A — Indexing → FTS backbone
        │     core extraction (docx/xlsx/pdf) → background job runner → SPA wiring of /api/search/content
        │
        ├─ Track B — Tags            (depends on A's search surface)
        │
        ├─ Track C — RAG / dochub-ai (depends on A: extraction + a job runner for embeds)
        │
        ├─ Track D — MCP / dochub-mcp (depends on A + C: exposes search/RAG/provenance as tools)
        │
        ├─ Track E — Agentic pipeline (job runner first — shared with A/C — then read-only agents)
        │
        └─ Track F — Production hardening (parallel, no deps):
              Redux + typed API layer · shared UI primitives · error/validation envelope · notes-paste bug
```

Phase mapping: Track A = **Phase 3**; Tags/Vaults ride Phase 3/UI; Provenance/Encryption/RBAC-audit = **Phase 0–1**; compliance signing = **Phase 4**; RAG/MCP/agentic = **Phase 5 (AI layer, read-only, audited)**. A durable **job runner** is the shared substrate under A, C, and E — build it once, early.

---

## 5. Known bugs & quick wins

- [ ] **Notes: pasted markdown doesn't render until reload.** File: `web/src/components/notes/MarkdownEditor.tsx`. **Root cause (corrected after reading the code):** `transformPastedText: true` is *already* set and `html: false` (lines 151–156). `tiptap-markdown`'s `transformPastedText` only hooks the **`text/plain`** paste path; when the clipboard also carries a **`text/html`** flavor (common when copying rendered markdown), ProseMirror takes the HTML path and the markdown transform is bypassed, so raw `**bold**` lands as literal text. On reload, `setContent(value)` (line ~271) re-parses the stored markdown and it renders — matching the symptom. **Candidate fix (verify in-browser):** add an `editorProps.handlePaste` (or `clipboardTextParser`) that, when the `text/plain` clipboard looks like markdown, routes it through `tiptap-markdown`'s parser and ignores the `text/html` flavor — OR gate on `event.clipboardData` to prefer plain-text markdown. Needs a browser repro + Playwright test; **not a blind edit.**
- [ ] _(verify)_ Content search returns nothing for `.docx`/`.pdf` **content** — expected until Office/PDF extraction lands (Track A); today those index title+extension only.
- [ ] _(verify)_ Confirm every mutating route has an `authz` guard + emits an audit event (coverage tests).

---

## 6. Recommended sequencing (PR by PR)

1. **Green Phase 0's gate** — land P0-3 (doc-byte envelope, boot-refuses-without-key) and P0-4 (hash-chain + `verify_chain` property tests). Non-negotiable foundation.
2. **PR 1 — quick win:** fix the notes markdown-paste bug (TipTap markdown paste). Small, user-visible.
3. **PR 2 — job runner:** durable `jobs` table + tokio worker loop (retries, idempotency). The shared substrate for indexing, embeds, reports.
4. **PR 3 — extraction:** `core`-backed docx/xlsx/pdf extraction in `dochub-index`; index on new-version, remove on tombstone, via the job runner.
5. **PR 4 — wire content search into the SPA:** the engine is already built + tested; surface it (snippets, highlights, filters). Ships a headline feature cheaply.
6. **PR 5 — tags:** `tags`/`document_tags` + endpoints + search facet + UI.
7. **PR 6 — frontend hardening (parallel):** Redux Toolkit + RTK Query typed API layer + error boundaries + `zod` response validation.
8. **Then Phase 5:** `dochub-ai` (embeddings + Claude provider) → `dochub-mcp` (tool surface) → agentic workflows on the job runner.

**First PR to open:** the **notes markdown-paste fix** (immediate, isolated, user-visible) — then the **job runner**, which unblocks indexing, RAG-embeds, and the agentic pipeline in one move.
