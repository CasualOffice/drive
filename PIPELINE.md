# Doc-Hub — Pipeline

**What this is:** the delivery/status tracker for the Drive→Doc-Hub revamp. It mirrors the phases in [`PLAN.md`](./PLAN.md) — what has shipped, what is in flight, and what is deferred. Read it alongside [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) and [`docs/TESTING.md`](./docs/TESTING.md).

**Posture:** every phase ships green on the full test contract before the next begins. The inviolable rules in [`CLAUDE.md`](./CLAUDE.md) — append-only history, everything tested — gate every row here.

**Status legend**

- **Shipped** — merged, tested, on `main`.
- **In progress** — actively being built in the current phase.
- **Queued** — scoped, not started; waiting on its phase.
- **Deferred** — explicit non-goal for the foreseeable future.

**Current phase: Phase 0 — Rename, narrow, and lay the hub foundations.** Nothing after Phase 2 starts until each predecessor's acceptance tests are green.

---

## Shipped — the inherited spine (from Casual Drive)

Built and tested before the revamp; kept as the foundation the hub is built on.

| # | Item | Status |
|---|---|---|
| SP1 | Rust workspace (crates), OpenDAL storage facade behind an `Arc<Storage>` trait | Shipped |
| SP2 | SQLite + Postgres portable migrations (TEXT ULID, ISO-8601 UTC, INTEGER bools) | Shipped |
| SP3 | Append-only `audit_log` | Shipped |
| SP4 | Projects/workspaces + members + roles + magic-link invitations; atomic ownership transfer | Shipped |
| SP5 | Argon2id passwords, `tower-sessions` + `__Host-` cookie, OIDC (Auth Code + PKCE) | Shipped |
| SP6 | Share links (password + expiry) on the isolated user-content origin | Shipped |
| SP7 | Two-origin security model; boot refuses equal origins in production | Shipped |
| SP8 | AES-256-GCM secret-envelope sealing for BYO-storage credentials (the crypto primitive we generalise to document bytes) | Shipped |
| SP9 | React SPA foundation; Astro marketing site | Shipped |

## Phase 0 — Rename, narrow, foundations

Turns the storage Drive into a document registry. Current phase.

| # | Item | Status | Acceptance |
|---|---|---|---|
| P0-1 | Rename `drive-*`→`dochub-*`, `DRIVE_*`→`DOCHUB_*`, product Casual Drive → Doc-Hub (mechanical, test-guarded) | In progress | Build + tests green under new names |
| P0-2 | Documents-only MIME allowlist (`docx, xlsx, csv, xlsm, pptx, pdf, md, txt, json, yaml`) on every ingest path, by extension + magic-byte sniff | In progress | Disallowed type rejected on proxy and direct paths (test) |
| P0-3 | `dochub-crypto`: envelope encryption for document bytes, per-workspace DEK wrapped by master KEK/KMS; boot refuses to start without a key | In progress | No plaintext reaches a spy backend; boot aborts without a key (test) |
| P0-4 | Version + hash-chain engine: `file_versions`, `content_hash`/`prev_hash`, write-once blobs, restore-as-new, chain verification; hash-chain the `audit_log` | In progress | N edits → N chained versions; tamper fails `verify_chain`; restore is additive (property tests) |
| P0-5 | Retire WOPI to optional interop; stub embedded-editor byte-serving as the primary path | Queued | — |

**Non-goals this phase:** search, AI, new editor UI, retention policy UI.

## Phase 1 — Encrypted hub + immutable history, end to end

| # | Item | Status | Acceptance |
|---|---|---|---|
| P1-1 | Key management: DEK generate/wrap/unwrap, KEK rotation that re-wraps without rewriting blobs, KMS adapter | Queued | Post-rotation, every document still decrypts (property test) |
| P1-2 | Version UI: per-document history timeline, diff, restore | Queued | Restore v*k* yields v*N+1* byte-equal to *k*, chain preserved (e2e) |
| P1-3 | Provenance export (who/when/why/hash), offline-verifiable | Queued | Export verifies offline against the chain |
| P1-4 | Retention + legal hold enforced in the delete/tombstone path | Queued | A held document cannot be tombstoned or purged by any path (test) |

## Phase 2 — Native embedded editing + co-editing

| # | Item | Status | Acceptance |
|---|---|---|---|
| P2-1 | Embed Casual Sheet / Docs / PDF via their SDKs; bytes decrypt server-side and stream over the app origin | Queued | open→edit→save round-trips `.docx`/`.xlsx` with fidelity parity (e2e) |
| P2-2 | Save path commits a new encrypted, hash-chained version + audit event | Queued | Each save lands as an ordered version |
| P2-3 | Real-time co-editing through the `collab` server (Yjs/Hocuspocus); presence | Queued | Two clients co-edit; both saves land as ordered versions (e2e) |

**Dependencies:** sibling editor SDK embed paths (`sheet` `SDK_ARCHITECTURE.md`, `document` `@casualoffice/docs`).

## Phase 3 — Content search

| # | Item | Status | Acceptance |
|---|---|---|---|
| P3-1 | `dochub-index`: `core`-backed extraction (docx/xlsx/pdf/md/txt/csv/json/yaml) → Tantivy full-text index; lazy background worker; `index_state` column | Queued | A phrase inside a `.docx`/`.pdf`/`.xlsx` is found by content (e2e) |
| P3-2 | Search surface: content snippets, highlights, type/project/date filters, "which document mentions X" | Queued | Snippet + highlight returned; reindex on new version; removal on tombstone |

## Phase 4 — Compliance + governance

| # | Item | Status | Acceptance |
|---|---|---|---|
| P4-1 | Document signing/provenance (Ed25519); issuer/registrar model (DigiLocker-style verified documents) | Queued | A registrar issues a signed document a recipient verifies offline |
| P4-2 | Retention policies + legal hold admin UI | Queued | Policy enforced across the tombstone path |
| P4-3 | Exportable audit + retention reports; optional transparency-log anchoring of chain heads | Queued | Exported report is complete and hash-verifiable |

## Phase 5 — AI layer

AI is **read-only** and never mutates documents or history. Every AI action is audited.

| # | Item | Status | Acceptance |
|---|---|---|---|
| P5-1 | `dochub-ai`: semantic search (embeddings + rerank alongside Tantivy, never replacing it for compliance-critical retrieval) | Queued | Semantic query surfaces a doc keyword search misses |
| P5-2 | Document/section summaries; entity + PII detection (suggestions, human-approved); cross-document Q&A | Queued | PII scan flags known fixtures; no document/history mutation |
| P5-3 | Pluggable provider (default Claude via the Anthropic API — Haiku for extraction/classification, Sonnet/Opus for reasoning; local-model option for air-gapped installs) | Queued | Provider swap leaves behaviour green |

---

## Deferred / non-goals

Explicit non-goals for the foreseeable future — do not queue without new research + a synthesis update.

| Item | Why |
|---|---|
| Zero-knowledge E2E encryption | The server holds keys by design so it can index + reason over content. Encryption defends stolen storage/DB, not a compromised trusted server. |
| Server thumbnails / media previews / sandboxed thumb-worker | Documents-only hub; no media rendering surface. Removed in the revamp. |
| Video / images-as-primary / arbitrary-file storage | Off the ingest allowlist. The narrow scope is what lets us encrypt, index, and version everything. |
| MS365 / Office-Online federation | Embedded native editors are the primary path; WOPI is optional interop only. |
| Sync clients, mailbox/calendar | Out of scope for a document registry. |
| Native desktop app | Casual Desktop lane, not this repo. |
| Full multi-IdP federation | OIDC (Auth Code + PKCE) against one compliant IdP is the floor; broader federation is unscoped. |

---

## Test gates (every phase)

`cargo fmt --check` · `cargo clippy --workspace -- -Dwarnings` · `cargo test --workspace` (unit + integration) · property tests for crypto/hash-chain/immutability · `pnpm --dir web test` + Playwright use-cases for touched surfaces · `cargo audit`/`cargo deny` · coverage ≥ 85%. See [`docs/TESTING.md`](./docs/TESTING.md).

## How to add a row

1. **What** — one short noun phrase.
2. **Which phase** — map it to a `PLAN.md` phase; don't smuggle later-phase work forward.
3. **Status** — Shipped / In progress / Queued / Deferred.
4. **Acceptance** — the concrete test that says "done."
