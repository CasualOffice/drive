# PLAN — Doc-Hub

Phased delivery plan for the Drive→Doc-Hub revamp. Each phase has scope, non-goals, acceptance tests, and dependencies. Read this alongside [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md), [`docs/TESTING.md`](./docs/TESTING.md), and the relevant [`docs/ux/`](./docs/ux/) surface.

**Posture:** never break the inviolable rules in [`CLAUDE.md`](./CLAUDE.md) — research first, plan UX, consistent UI, secure code, macOS-grade polish, **append-only history, everything tested.** Every phase ships green on the full test contract before the next begins.

## Where we are

- **Foundations through Phase 3 have shipped and are released** (`casualoffice/dochub` v0.0.1/v0.0.2). Phase 0 (rename, documents-only ingest, `dochub-crypto` document-byte envelope, hash-chain version + audit engine, two-origin isolation), Phase 1 (encryption at rest + KEK rotation + provenance), and the search/AI backbone (Tantivy content search, Office/PDF extraction, tags, RAG, MCP, agentic worker) are all merged and tested on `main`. See [`docs/CAPABILITY-TRACKER.md`](./docs/CAPABILITY-TRACKER.md) §2 for the verified matrix.
- **Current focus: production hardening** — a security + operability sweep (2026-07-19) closed a batch of adversarial-review findings and every unbounded-hang vector; see CAPABILITY-TRACKER §1a. Remaining work is native co-editing depth, later-phase compliance/vault UX, and the frontend state layer.
- The original phase-gate rule still holds for *new* later-phase features: don't start a phase's code before its predecessors' acceptance tests are green. (Physical erasure remains a deliberate Phase-4 item — not started.)

## Starting point (inherited from Casual Drive)

Already built and tested, kept as the spine:
- Rust workspace (crates), OpenDAL storage facade, SQLite/Postgres-portable migrations.
- Append-only `audit_log`; projects/workspaces + members + roles + magic-link invitations.
- Argon2id auth, `tower-sessions`, OIDC, share-links (password + expiry), two-origin model.
- AES-256-GCM secret-envelope sealing (used for BYO-storage creds) — the crypto primitive we generalise to document bytes.
- React SPA foundation; Astro marketing site.

Removed in the revamp (obsolete for a docs-only hub): server/video thumbnails and the thumbnail worker, MS365/Office-Online federation, media previews, arbitrary-file storage.

## Phase 0 — Rename, narrow, foundations

**Scope**
- Rename product Casual Drive → Doc-Hub; `drive-*`→`dochub-*`, `DRIVE_*`→`DOCHUB_*` (mechanical, test-guarded).
- Enforce the **documents-only MIME allowlist** on every ingest path (extension + magic-byte sniff).
- Retire WOPI to optional interop; make embedded-editor byte-serving the primary path stub.
- Stand up `dochub-crypto`: envelope encryption for document bytes, per-workspace DEK wrapped by master KEK/KMS. Boot refuses to start without a key.
- Stand up the **version + hash-chain engine**: `file_versions` table, `content_hash`/`prev_hash`, write-once blobs, restore-as-new, chain verification. Hash-chain the `audit_log`.

**Non-goals:** search, AI, new editor UI, retention policy UI.

**Acceptance**
- Upload of a disallowed type is rejected (test) on both proxy and direct paths.
- No plaintext document bytes reach any storage backend (property/integration test with a spy backend).
- Boot aborts without a master key (test).
- Editing a document N times yields N chained versions; tampering with any stored version fails `verify_chain` (property test); restoring version k creates version N+1 identical to k, destroying nothing.

## Phase 1 — Encrypted hub + immutable history, end to end

**Scope**
- Key management: DEK generation/wrap/unwrap, rotation that re-wraps without rewriting blobs, KMS adapter.
- Version UI: history timeline per document, diff, restore, provenance (who/when/why/hash) export.
- Retention + legal hold enforcement in the delete/tombstone path.

**Acceptance:** key rotation leaves all documents readable; a document under legal hold cannot be tombstoned or purged (test); provenance export verifies offline against the chain.

## Phase 2 — Native embedded editing + co-editing

**Scope**
- Embed Casual Sheet / Docs into the SPA via their SDKs; bytes decrypt server-side and stream to the editor over the app origin.
- Save path commits a new encrypted, hash-chained version + audit event.
- Real-time co-editing through the `collab` server for team documents; presence.

**Dependencies:** sibling editor SDK embed paths (`sheet` `SDK_ARCHITECTURE.md`, `document` `@casualoffice/docs`).
**Acceptance:** open→edit→save round-trips a `.docx` and `.xlsx` with fidelity parity to the standalone editors (e2e); two clients co-edit a document and both saves land as ordered versions.

## Phase 3 — Content search

**Scope**
- `dochub-index`: `core`-backed extraction (docx/xlsx/pdf/md/txt/csv/json/yaml) → Tantivy full-text index. Lazy background worker mirroring the retired thumb-worker pattern; `index_state` column.
- Search surface: content snippets, highlights, type/project/date filters, "which document mentions X".

**Acceptance:** a phrase inside a `.docx`/`.pdf`/`.xlsx` is found by content (e2e); reindex on new version; index removal on tombstone.

## Phase 4 — Compliance + governance

**Scope**
- Document signing/provenance (Ed25519), issuer/registrar model (DigiLocker-style verified documents).
- Retention policies + legal hold admin UI; exportable audit + retention reports; optional transparency-log anchoring of chain heads.

**Acceptance:** an exported audit report is complete and hash-verifiable; a registrar can issue a signed document a recipient can verify offline.

## Phase 5 — AI layer

**Scope**
- `dochub-ai`: semantic search (embeddings, rerank alongside Tantivy — never replacing it for compliance-critical retrieval), document/section summaries, entity + PII detection (suggestions, human-approved), cross-document Q&A.
- Pluggable provider (default Claude via the Anthropic API; local-model option for air-gapped installs). AI never auto-mutates documents or history.

**Acceptance:** semantic query returns relevant docs a keyword query misses; PII detection flags known fixtures; every AI action is read-only and audited.

## Deferred / non-goals

Zero-knowledge E2E, media/heavy storage, sync clients, mailbox/calendar, native desktop app (Casual Desktop lane), full multi-IdP federation.

## Test gates (every phase)

`cargo fmt` · `cargo clippy -Dwarnings` · `cargo test --workspace` (unit + integration) · property tests for crypto/hash-chain/immutability · `pnpm test` + Playwright use-cases for touched surfaces · `cargo audit`/`cargo deny` · coverage ≥ 85%. See [`docs/TESTING.md`](./docs/TESTING.md).
