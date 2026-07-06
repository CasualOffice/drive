# CLAUDE.md — instructions for contributors and AI assistants in this repo

## What this project is

**Doc-Hub** — the CasualOffice Document Hub. A self-hostable, encrypted, tamper-evident **document registry and hub** for teams and individuals. Documents in; permanent, hash-chained, content-searchable history out. Part of the Casual Office suite (`casualoffice.org`).

Single Rust binary, two HTTP origins, pluggable encrypted storage backends, project/team accounts, embedded native editors, polished web UI.

> Revamped from the former "Casual Drive" (a storage Drive). Where docs still say `drive-*` / `DRIVE_*`, read them as `dochub-*` / `DOCHUB_*` in flight — the rename is Phase 0 in `PLAN.md`.

## Inviolable rules

Set by the user. Never broken.

1. **Research first.** Investigate prior art before proposing. Briefs live in `docs/research/`.
2. **Plan UX.** Numbered flows before pixels. Spec lives in `docs/ux/01-flows.md`.
3. **Consistent UI.** Surfaces, copy, motion all coherent. Spec lives in `docs/ux/02-surface.md`.
4. **Industry-standard secure coding.** No homebrew crypto/auth. OWASP-aware. Checklist in `docs/research/06-security.md`.
5. **Polished, minimalistic design.** macOS-*app*-grade polish — Things 3 / Linear / Raycast quality bar, professional and simple, NOT a Finder or Drive clone. Tokens + 10 commandments in `docs/research/04-polish-principles.md`.
6. **History is append-only.** No code path may overwrite or hard-delete a committed document version, an audit event, or a hash-chain link. Destructive-looking operations are tombstones + retention, never erasure. This is the product.
7. **Everything is tested.** No feature merges without unit + integration tests; user-facing flows carry an e2e use-case test; crypto and immutability invariants carry property tests. See `docs/TESTING.md`.

Default working mode: **plan → present → ask → code.** Do not skip the planning loop.

## Product scope

**Documents only.** The ingest MIME allowlist is authoritative: `docx, xlsx, xlsm(opaque), pptx, pdf, md, txt, csv, json, yaml`. Everything else is rejected at upload. No video, images-as-primary, archives, or arbitrary binaries. The narrow scope is what lets us encrypt, index, and version everything.

In scope:
- Projects (team + personal locker), folders, documents, roles, invitations.
- Native embedded editing (Sheet/Docs/PDF/Markdown) with real-time co-editing.
- Immutable, hash-chained version history; restore-as-new; diff; provenance export.
- Encryption at rest + in transit; per-workspace data keys.
- Content full-text search (`core` + Tantivy); optional AI layer.
- Compliance: audit log, retention, legal hold, document signing/provenance, reports.
- Sharing (password + expiry) on the isolated user-content origin.

Out of scope:
- **Zero-knowledge E2E.** The server holds keys by design so it can index + reason over content. Encryption defends stolen storage/DB, not a compromised trusted server.
- **Heavy/binary/media storage, sync clients, mailbox/calendar.**
- **Native desktop app** — that is the Casual Desktop lane.

## Stack (locked)

- **Backend:** Rust + Axum 0.8 + tokio + tower.
- **Storage:** OpenDAL behind a thin `Storage` facade (fs / memory / S3 / MinIO / R2 / B2), with a mandatory at-rest **encryption layer** in `dochub-crypto`.
- **Crypto:** AES-256-GCM envelope encryption; per-workspace DEK wrapped by a master KEK or external KMS; SHA-256 hash chains for versions + audit; Ed25519 for provenance signing. No homebrew primitives — use `ring`/`aws-lc-rs` and audited crates.
- **DB:** SQLite default, Postgres for production. Every migration portable across both (TEXT ULIDs, ISO-8601 UTC, INTEGER 0/1 bools, no JSONB/enum/native-UUID).
- **Auth:** Argon2id passwords, `tower-sessions` + `__Host-` cookie, OIDC (Authorization Code + PKCE).
- **Editors:** embedded via the sibling editor SDKs (Sheet/Docs/PDF). Bytes are decrypted server-side and streamed to the embedded editor over the authenticated app origin. **WOPI is optional interop only** — not the primary editing path.
- **Co-editing:** the `collab` server (Yjs / Hocuspocus), which relays opaque document bytes.
- **Index/AI:** `core` for extraction; Tantivy for full-text; `dochub-ai` wraps a pluggable LLM provider (default Claude via the Anthropic API — Haiku for extraction/classification, Sonnet/Opus for reasoning/Q&A — with a local-model option for air-gapped installs).
- **Frontend:** React + Vite + Radix + `@schnsrw/design-system` tokens.
- **Delivery:** `rust-embed` single binary; `cargo-chef` multi-stage Docker on `debian:trixie-slim`.

Reopening any locked decision requires new research + a synthesis update in `docs/research/00-synthesis.md`.

## Required reading before substantive work

1. [`PLAN.md`](./PLAN.md) — phased delivery plan; know which phase we're in.
2. [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — storage facade, encryption layer, version/hash-chain engine, two-origin model, token model, editor embedding.
3. [`docs/TESTING.md`](./docs/TESTING.md) — the test contract every PR is measured against.
4. [`docs/research/00-synthesis.md`](./docs/research/00-synthesis.md) — locked decisions + tension resolutions.
5. [`docs/research/06-security.md`](./docs/research/06-security.md) — threat model + security checklist.
6. [`docs/ux/01-flows.md`](./docs/ux/01-flows.md) + [`docs/ux/02-surface.md`](./docs/ux/02-surface.md).

## Hard rules

### Every committed version is immutable and hash-chained
- A version row stores `content_hash = SHA-256(ciphertext)` and `prev_hash` (the previous version's `content_hash`). The chain head is the file's current version. Verification recomputes the chain; a break is a tamper alarm, surfaced, never silently repaired.
- Version blobs are content-addressed and write-once. "Delete" sets a tombstone and obeys retention/legal-hold; it never removes bytes under hold.
- The `audit_log` is append-only and itself hash-chained. Never `UPDATE`/`DELETE` a committed audit row.

### Storage goes through the facade — always, encrypted
- Handler code talks to `Arc<Storage>`; never `opendal::Operator` directly. Bytes are encrypted by `dochub-crypto` before they reach the backend and decrypted after they leave it. No plaintext document bytes are ever written to a storage backend.
- New backends are added by listing a new `opendal::services::*` builder; the trait does not grow.

### Encryption is not optional
- No config flips off at-rest encryption. Boot **refuses to start** without a master KEK (or configured KMS). Keys never appear in logs, errors, or responses.
- Per-workspace DEKs are wrapped, not stored plaintext. Key rotation re-wraps DEKs without rewriting document blobs.

### Two-origin model is non-negotiable
- App origin serves SPA, JSON API, embedded-editor byte streams. Strict CSP. Session cookies live here only.
- User-content origin serves `/raw/{token}` (share-link + isolated content) only. `CSP: sandbox; default-src 'none'`, no cookies, `Content-Disposition: attachment` for non-previewable types.
- Boot **refuses to start in production** if `app_origin == usercontent_origin`. Test this.

### Tokens: distinct purposes, never confused
- **Session cookie** (`__Host-` prefixed): the user's browser session; server-side store.
- **Editor access token**: per-launch, per-document, short TTL, HMAC-signed claim `(user_id, file_id, perms, exp, jti)`; document-id in URL must match the claim.
- **Share-link token**: per-row, constant-time compared against the DB.
- **Signed-URL token**: fs/mem `/raw/{token}` HMAC over `(key, exp, method)`.

### Ingest is allowlisted + sniffed
- Enforce the documents-only MIME allowlist on every upload path (proxy and direct-to-storage), by extension **and** magic-byte sniff. Reject, don't quarantine.

### Polish bar is enforceable
The 10 commandments in `docs/research/04-polish-principles.md` gate every UI PR; a break must be called out and justified.

## Working rules

1. **Read before you write.** Read the relevant flow + surface + architecture section first; cite paths in PRs (`crates/dochub-crypto/src/envelope.rs:142`).
2. **Match the tone.** Terse, decision-oriented, present-tense, sentence-case. No marketing prose, no exclamation marks. Mirror `../sheet/CLAUDE.md` and `../document/CLAUDE.md`.
3. **Ship tests in the same PR.** Per `docs/TESTING.md`. A PR that changes behaviour without a test is incomplete.
4. **Update docs in the same commit as the code.** Change a flow → update `01-flows.md`; change the crypto layer → update `ARCHITECTURE.md`. Stale docs poison every future session.
5. **Don't propose unbacked alternatives.** The locked stack is locked. Reopening needs research + a synthesis update.
6. **Depend on `core` for document knowledge.** Text extraction, format parsing, and conversion live in `core`, not re-implemented here.
7. **Don't add runtime dependencies casually** — especially crypto. Justify in the PR; prefer audited crates.

## Phase awareness

Always know the current phase (top of `PLAN.md`). Phase 0 is the Drive→Doc-Hub rename + scope narrowing + encryption/immutability foundations. Do not start a later phase's code before its predecessors' gates are green.
