# 00 — Research Synthesis

Distillation of briefs 01–16 for **Doc-Hub** — the CasualOffice Document Hub. What's locked, what's open, what changed when Casual Drive (a storage Drive) became a document registry & hub. This is the canonical map of locked decisions and the tensions we resolved to get here.

> Naming in flight: `drive-*`→`dochub-*`, `DRIVE_*`→`DOCHUB_*`. Crate dirs on disk may still read `drive-*`; the target `dochub-*` names are canonical.

## The shift, in one paragraph

Casual Drive stored arbitrary files and handed them to sibling editors over WOPI. Doc-Hub keeps *documents* — a narrow allowlist — and treats them as records: encrypted at rest, versioned forever in a tamper-evident hash chain, edited natively in-app, and searchable by content. The narrowing (documents only, no media/thumbnails) and the deliberate choice of **server-trusted** encryption (not zero-knowledge) are what make full-content indexing and an optional AI layer possible. Everything below follows from those two moves.

## Locked decisions (sourced from briefs)

| Area | Decision | Source |
|---|---|---|
| Product | **Doc-Hub** — encrypted, tamper-evident document registry & hub (DigiLocker-like) | README, CLAUDE |
| Scope | **Documents only.** Ingest allowlist: `docx, xlsx, csv, xlsm(opaque), pptx, pdf, md, txt, json, yaml`. No video, images-as-primary, archives, media previews, or thumbnails | CLAUDE, 06 §3 |
| Encryption model | **Server-trusted, NOT zero-knowledge E2E.** At-rest (AES-256-GCM envelope, per-workspace DEK wrapped by master KEK/KMS) + in-transit (TLS). Chosen so the server CAN index + run AI over content | 06 §14, ARCHITECTURE |
| Immutable history | Append-only, hash-chained `file_versions` (`content_hash`/`prev_hash`); write-once content-addressed blobs; restore-as-new; no hard delete. `audit_log` append-only + hash-chained | ARCHITECTURE, CLAUDE |
| Backend framework | **Axum 0.8** (tokio/tower/hyper native) | 05 §1 |
| Storage abstraction | **OpenDAL** behind a thin `Storage` facade + a mandatory at-rest encryption layer | 03 §9, 05 |
| Storage backends | fs, memory, S3, MinIO, R2, B2 via `opendal::services`; BYO-bucket creds sealed with the same envelope scheme | 03 §1 |
| Editing | **Embedded native editors** (Sheet/Docs/PDF/Markdown) in the SPA; bytes decrypt server-side and stream over the app origin. Real-time co-editing via the `collab` server | ARCHITECTURE, PLAN P2 |
| WOPI | **Demoted to optional interop** for external Office clients — not the primary editing path | CLAUDE, 01 |
| Search | Full-text over document *content* via the Rust `core` extraction engine + **Tantivy** index; lazy background worker; `index_state` column | ARCHITECTURE, PLAN P3 |
| AI layer | **Optional `dochub-ai`** — semantic search, summaries, PII detection, cross-doc Q&A. Read-only, never mutates documents/history. Pluggable provider; default Claude via the Anthropic API (Haiku for extraction/classification, Sonnet/Opus for reasoning); local-model option for air-gapped installs | ARCHITECTURE, PLAN P5 |
| Projects & teams | Projects (team + personal locker), folders, Owner/Admin/Member roles, magic-link invitations, atomic ownership transfer | README, 02 |
| Compliance | Audit log, retention policies, legal hold, document signing/provenance (Ed25519), exportable reports | PLAN P4, 06 |
| Session layer | `tower-sessions`, server-side, `__Host-` cookie | 02 §3, 05 §4 |
| Password hash | `argon2id`, OWASP minimum `m=19 MiB, t=2, p=1` | 02 §3, 06 §7 |
| OIDC | Authorization Code + PKCE against any compliant IdP; sessions stay Doc-Hub-side | 12, 02 |
| Two-origin model | App origin `hub.<host>` vs user-content origin `usercontent-doc-hub.<host>`. **Boot refuses prod if they match.** | 06 §4 (non-negotiable #1) |
| Ingest guard | Documents-only MIME allowlist enforced on every ingest path — by extension **and** magic-byte sniff. Reject, don't quarantine | CLAUDE, 06 §3 |
| Build & deploy | `rust-embed` SPA in a single static binary, `cargo-chef` multi-stage Dockerfile, `debian:trixie-slim` runtime | 05 §10–11 |
| DB | SQLite default, Postgres for production; every migration portable (TEXT ULIDs, ISO-8601 UTC, INTEGER 0/1 bools; no JSONB/enum/native-UUID) | 05, 06 |
| CI security gates | `cargo audit --deny warnings` + `cargo deny check` on every PR | 06 §12 |
| Quality bar | **Production-grade, fully tested** — unit + integration + property + e2e use-cases; coverage ≥ 85%; crypto/immutability carry property tests | TESTING, CLAUDE #7 |

## Cross-brief tensions and resolutions

| # | Tension | Resolution |
|---|---|---|
| 1 | 03-storage recommends **OpenDAL**; 05-rust-stack §5/§12 sketches a hand-rolled trait with `aws-sdk-s3` | **OpenDAL wins.** Capability gaps, retry/tracing layers, all backends first-class, Apache TLP governance. The facade additionally hosts the mandatory at-rest encryption layer, so no handler ever reaches raw bytes. Drop `aws-sdk-s3` from the starter `Cargo.toml`. |
| 2 | Encrypt at rest ourselves vs "encryption is the storage substrate's job" (old 06 §14) | **We encrypt, in `dochub-crypto`, mandatorily.** A hub cannot delegate its core promise to whatever bucket the operator picked. Boot refuses to start without a master KEK/KMS. SSE at the substrate is defence-in-depth on top, not a substitute. |
| 3 | Zero-knowledge E2E (max privacy) vs server-trusted (server can read plaintext) | **Server-trusted, deliberately.** E2E would make content search, extraction, and the AI layer impossible, and would break server-side co-editing and provenance. We instead scope the guarantee honestly: encryption defeats a stolen disk/DB, not a compromised trusted server. Documented as a non-goal, not a gap. |
| 4 | Embedded native editors vs WOPI as the editing path | **Embedded is primary; WOPI is optional interop.** The suite owns the editors (Sheet/Docs/PDF); embedding lets bytes decrypt server-side and stream over the authenticated app origin, and lets save append a hash-chained version directly. WOPI stays for external Office clients only. |
| 5 | 02-auth wants `SameSite=Strict`; 06-security wants `SameSite=Lax` | **`SameSite=Lax`.** The optional WOPI interop path still relies on cross-site editor redirects that Strict would block; Lax + CSRF token + Origin check is the standard belt-and-braces. |
| 6 | Search backend: external OpenSearch (old 16) vs embedded Tantivy | **`core` + Tantivy, embedded.** The hub indexes document *content*, which the extraction engine (`core`) produces; Tantivy keeps it in the single binary with no second service to run for a $5-VPS install. A `dochub-index` background worker owns the pipeline. OpenSearch is not adopted. |
| 7 | 02-auth references `axum-login`; 05-rust-stack §4 says skip it | **Skip `axum-login` for v0.** `tower-sessions` + a ~30-LoC extractor is the dominant pattern. Add it only if friction emerges. |
| 8 | 05-rust-stack §5 wonders if AFIT works for `dyn Storage`; 03-storage §3 confirms native AFIT is **not** object-safe in 2026 | **Use `#[async_trait]` + `Arc<dyn Storage>`.** One heap alloc per call, irrelevant against I/O and crypto. |

## Surprises that changed the plan

1. **The Drive is a spine, not a rewrite.** The inherited app already ships the OpenDAL facade, portable SQLite/Postgres migrations, an append-only `audit_log`, projects/members/invitations, Argon2id + `tower-sessions` + OIDC, share-links, the two-origin model, and — critically — **AES-256-GCM secret-envelope sealing for BYO-storage creds.** That envelope primitive generalises directly to document bytes; `dochub-crypto` extends it rather than inventing it.
2. **Documents-only is a feature, not a limitation.** Refusing media/arbitrary blobs is what lets us encrypt everything, index everything, and version everything without a per-type exception matrix. The old thumbnail/media-preview/MS365-federation surfaces are removed, not ported.
3. **Immutability is the product.** No code path may overwrite or hard-delete a committed version, an audit row, or a hash-chain link. "Delete" is a tombstone under retention/legal-hold. This is an inviolable rule, property-tested.
4. **AI is read-only by construction.** `dochub-ai` never mutates documents or history; every AI action is audited. Semantic search reranks *alongside* Tantivy, never replacing exact retrieval for compliance-critical queries.
5. **WOPI scaffolding is retained as interop, not thrown away.** The sibling editors' WOPI code still works for external Office clients; it simply stops being the default handoff.

## Open questions

Resolved:

| # | Question | Decision |
|---|---|---|
| 1 | Zero-knowledge E2E? | **No.** Server-trusted by design so we can index + run AI. Stated as a non-goal in every canonical doc. |
| 2 | Macro-enabled Office (`.xlsm`/`.docm`/`.pptm`)? | **`.xlsm` accepted as an opaque, versioned, encrypted blob; refuse open-in-editor.** `.docm`/`.pptm` rejected. |
| 3 | Casual Slides (`.pptx` editor)? | **Slot reserved.** `.pptx` accepted and versioned; no embedded editor handoff wired yet. |
| 4 | Metadata DB — SQLite or Postgres? | **Both.** SQLite default and only required engine; Postgres for production. Every migration portable; CI runs both. |
| 5 | Search backend — external service or embedded? | **Embedded `core` + Tantivy.** No OpenSearch dependency. |

Still open (does not block the current phase):

- **Domain operational shape** — the two-origin split (`doc-hub.casualoffice.org` + `usercontent-doc-hub.casualoffice.org`) and reverse-proxy examples. Park until deployment-config phase.
- **AI provider defaults per install** — Claude via the Anthropic API by default; the local-model adapter's exact runtime (llama.cpp/ONNX) is a Phase 5 decision.
- **Transparency-log anchoring** — optional Ed25519-signed anchoring of chain heads for third-party-verifiable provenance; shape sketched in Phase 4, not yet locked.

## What's next

Follows `PLAN.md`:

1. **Phase 0** — rename, narrow to the documents-only allowlist, stand up `dochub-crypto` (envelope encryption for document bytes) and the version + hash-chain engine; demote WOPI.
2. **Phase 1** — key management (rotation, KMS), version UI (timeline/diff/restore/provenance export), retention + legal hold enforcement.
3. **Phase 2** — embedded editing + co-editing.
4. **Phase 3** — content search (`dochub-index`: `core` extraction → Tantivy).
5. **Phase 4** — compliance & governance (Ed25519 signing, registrar model, reports).
6. **Phase 5** — the optional AI layer.

Each phase ships green on the full test contract (`docs/TESTING.md`) before the next begins.
