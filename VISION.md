# Doc-Hub — Vision

> This document states what Doc-Hub is, why it exists, who it is for, and how we build it. It is the target the rest of the repo is measured against. Read it before `PLAN.md`, `ROADMAP.md`, or any code.

## The pivot: from Casual Drive to Doc-Hub

This repository began as **Casual Drive** — a self-hosted, file-centric Drive: upload anything, open `.xlsx`/`.docx` in the browser, share links. A good storage product, but storage is a crowded, commoditised lane (Nextcloud, Seafile, CryptPad, S3-with-a-UI). Competing there means competing on gigabytes and sync clients.

The unmet need we kept running into is different. Teams don't struggle to *store* documents — they struggle to **trust** them:

- Which version is authoritative, and what changed between versions?
- Who edited this, when, and can we *prove* it to an auditor?
- Is the sensitive contract encrypted, or sitting as plaintext on a disk someone can walk off with?
- Can I find the one document that mentions a name, a clause, an ID — across everything?
- Can a person keep their own records — degrees, IDs, contracts — in a private, durable, self-owned locker?

So we pivoted. **Doc-Hub is not a Drive. It is a document registry and hub** — a place where documents are owned, versioned immutably, encrypted, searchable by content, and accountable by an audit trail you cannot rewrite. A DigiLocker for teams and individuals, that you run on your own server.

## What Doc-Hub is

An open-source, self-hosted **document hub / registry** for a deliberately narrow set of formats — `docx, xlsx, pdf, md, txt, csv, json, yaml`. It is built on four promises:

1. **History is permanent.** Every save appends a new, hash-chained version. Nothing is overwritten or erased — tampering breaks the chain and is detectable. A registry, not a folder.
2. **Documents are encrypted.** Every file is encrypted at rest (AES-256-GCM envelope, per-workspace keys) and in transit. A stolen disk or database dump is ciphertext.
3. **Editing is native.** Documents open in embedded Casual Sheet / Docs / PDF / Markdown editors, with real-time co-editing — one app, not a launcher.
4. **Everything is findable and accountable.** Full-text search reads *inside* documents; an append-only audit log records every action; compliance workflows (retention, legal hold, provenance) sit on top.

## North star

> Become the best open-source place to keep documents you cannot afford to lose, leak, or have altered — for organisations and individuals who value ownership, durability, privacy, and proof.

## Who it's for, and for what

- **Maintainers & registrars** keeping an authoritative, tamper-evident record.
- **Compliance, legal & HR teams** who must prove what changed, when, and by whom.
- **Privacy-first & self-hosting teams** who want their documents on their own server, encrypted, no SaaS.
- **Individuals** wanting a private, DigiLocker-style locker for personal and professional papers.

## What Doc-Hub is not

- **Not general cloud storage** — documents only. No video, media libraries, disk-image dumps, or "put anything here."
- **Not zero-knowledge E2E.** The server holds keys *by design*, so it can index content and power search + AI. Encryption defeats a stolen disk or database — not a fully compromised, trusted server. We state this plainly rather than over-promising.
- **Not a mailbox, calendar, sync client, or a native desktop app** — the local editing lane is Casual Desktop.

## How we build: documents-first

This repo is **documents-first**. Design, architecture, and a clear target come *before* code — always.

1. **Target before work.** No feature starts without a written statement of what it is and why (this doc, `PLAN.md`, the `docs/ux/` flow, the `docs/research/` brief).
2. **Design & architecture before implementation.** A change is specified in `docs/ARCHITECTURE.md` and the relevant surface spec before it is built. `plan → present → ask → code` is the default loop.
3. **Everything tested.** Nothing merges without unit + integration tests; user flows carry an e2e use-case; crypto and immutability invariants carry property tests (`docs/TESTING.md`).
4. **History is append-only** — in the product *and* in how we work: docs are updated in the same change as the code, never left stale.

The proof is this repository: a complete design, architecture, security model, test contract, and phased plan — with no production code yet written for the pivot. We build the map before the territory.

## Where to go next

- **[`ROADMAP.md`](./ROADMAP.md)** — the phase/tier release plan, in public.
- **[`PLAN.md`](./PLAN.md)** — the detailed phased delivery plan with acceptance tests.
- **[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)** — how it fits together.
- **[`docs/TESTING.md`](./docs/TESTING.md)** — the quality bar.
- **[Discussions](https://github.com/CasualOffice/dochub/discussions)** — tell us where this vision is right or wrong.

Doc-Hub is Apache-2.0, self-hosted, and built in the open.
