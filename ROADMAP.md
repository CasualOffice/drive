# Doc-Hub — Roadmap

The public, phase-gated plan for turning this repo from **Casual Drive** into **Doc-Hub**. Read [`VISION.md`](./VISION.md) for the why, [`PLAN.md`](./PLAN.md) for the detailed scope + acceptance tests, and [`PIPELINE.md`](./PIPELINE.md) for shipped-vs-deferred status.

Live tracking is on the **[Doc-Hub Roadmap project board](https://github.com/orgs/CasualOffice/projects/1)**; discussion and requests go to **[Discussions](https://github.com/CasualOffice/drive/discussions)**.

## How we ship

- **Documents-first.** Design, architecture, and a clear target are written before code (see `VISION.md` → "How we build"). This roadmap is a promise about *sequence*, not dates.
- **Phase-gated.** A phase starts only when the previous phase's acceptance tests are green. No phase-hopping.
- **Everything tested.** Each phase ships green on the full test contract (`docs/TESTING.md`) — unit, integration, property (crypto/immutability), and e2e use-cases.
- **Append-only.** History is never rewritten — in the product, and in these docs.

## Release tiers

| Tier | Meaning | Gate |
|---|---|---|
| **Foundation** | The registry spine: encryption + immutable history, provable and tested. Not yet a daily driver. | Phases 0–1 |
| **Alpha** | Self-hostable and usable end-to-end: edit, version, search. Rough edges expected. | Phases 2–3 |
| **Beta** | Compliance-ready: audit, retention, legal hold, provenance. Suitable for real records with care. | Phase 4 |
| **1.0** | Production-grade, with the intelligence layer and hardening. | Phase 5 + hardening |

## Now · Next · Later

### Now — Foundation (Phases 0–1)
- Rename + narrow to a documents-only registry; retire storage/Drive surface area.
- `dochub-crypto`: envelope encryption at rest, per-workspace keys, boot refuses without a master key.
- Immutable **hash-chained version engine**: append-only, write-once, restore-as-new, tamper-evident; hash-chained audit log.
- Key management (rotation without rewriting blobs), version history UI, retention + legal hold enforcement.

### Next — Alpha (Phases 2–3)
- **Embedded native editing** (Sheet/Docs/PDF/Markdown) with real-time co-editing; every save is a new version.
- **Content search** — `core`-backed extraction → Tantivy full-text ("which document mentions X"), snippets, filters.

### Later — Beta → 1.0 (Phases 4–5)
- **Compliance & governance** — signed provenance (registrar/issuer model), retention policies, legal hold, verifiable audit/retention exports, optional transparency-log anchoring.
- **AI layer** — semantic search, summaries, PII detection, cross-document Q&A; read-only, human-approved, audited; pluggable provider with a local-model option for air-gapped installs.

## Deliberately not on the roadmap

Zero-knowledge E2E, media/heavy-file storage, sync clients, mailbox/calendar, a native desktop app (that is the Casual Desktop lane), and full multi-IdP federation. See `VISION.md` → "What Doc-Hub is not".

## The demo

The live web demo will be revamped alongside the **server + web-app** implementation (Phase 2+), once the `dochub-*` crates and the new SPA exist. Until then the demo reflects the pre-pivot Casual Drive UI.

## Feedback shapes this

The order above is a default, not a contract. If your use-case needs Phase 4 compliance before Phase 3 search, say so in [Discussions](https://github.com/CasualOffice/drive/discussions) — priorities move with real needs.
