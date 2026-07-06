# Doc-Hub — phased UI rollout

Maps the UI system (`docs/design/ui-system.md`) onto the product phases (`PLAN.md`) and release tiers (`ROADMAP.md`). Answers three questions: **what ships in which phase**, **what the earliest usable shell is**, and **how compliance/security UI lands incrementally**.

Rules of the road: no phase-hopping — a surface ships only when its backend gate is green. Every component ships with its full state matrix from `ui-system.md §7` (default/hover/focus/active/disabled/loading/empty), or it does not ship. Compliance surfaces (§8) are load-bearing, never deferred as "polish."

Tier ↔ phase map (from `ROADMAP.md`):

| Tier | Phases | UI posture |
|---|---|---|
| **Foundation** | 0–1 | The shell exists; history + encryption are visible and trustworthy. Not a daily driver. |
| **Alpha** | 2–3 | Edit, version, and search in-app. Usable end to end. |
| **Beta** | 4 | Compliance admin surfaces; provenance issuance. Real records with care. |
| **1.0** | 5 + hardening | AI (read-only) woven in; every surface polished and audited. |

---

## Phase 0 — the shell (Foundation)

Backend gate: rename, MIME allowlist, `dochub-crypto`, version + hash-chain engine, hash-chained audit log. No editor, search, retention UI, or AI.

**Earliest usable shell — the smallest thing a person can log into and trust.** A read-mostly registry: browse projects → folders → documents, upload an allowed type, download, see that history and encryption are real. No editing, no search box that does anything, no admin.

Ships (design tokens + primitives first — everything else composes from these):

- **Design foundation** — all of `ui-system.md §2–§6`: color tokens (light default + dark), type scale, 4px space/density grid, radii, elevation, motion, Lucide icon set. Landed once, consumed by every later phase. `prefers-reduced-motion` and AA contrast (§9) are wired from day one, not retrofitted.
- **App shell (§7.1)** — sidebar (Personal locker · Projects · Activity · Trash), 48px top bar, breadcrumb + toolbar. Command-K trigger is **present but stubbed**: opens, shows recent + shortcuts, no content search yet (that lands Phase 3). AI block absent.
- **Document table row (§7.2)** — the signature surface. Columns render; version column is live (`v12` mono, opens the history panel). Status cluster shows **only what Phase 0 backs**: `lock` (encrypted, ambient) + `shield-check`/`shield-alert` (chain intact/tamper). No `gavel`/`badge-check` yet.
- **Version-history timeline + hash-chain viz (§7.3)** — read-only in Phase 0: nodes, `prev_hash` links, per-link intact/broken markers, click-to-copy hashes, "Verify chain" button (runs `verify_chain`, per-node spinners → summary). **Restore is present** (engine backs restore-as-new); diff and provenance export are not.
- **Verification badge (§7.5)** and **Encryption/lock badge (§7.6)** — both integrity primitives ship here because the engine backs them. Tamper is a first-class alarm from the first release.
- **Audit-trail row (§7.4)** — the `Activity` surface, read-only, day-grouped, hash-chained, event-hash copy. Backed by the hash-chained audit log. Filters land minimal (actor/date); export lands Phase 4.
- **Core primitives** — buttons (§7.9), inputs (§7.10), dialogs (§7.11: new project, move, upload, restore-as-new confirm), toasts (§7.12), skeletons (§7.13), empty states (registry/stack motif). These are shared infrastructure; every later phase reuses them.

Deliberately **not** in Phase 0: editor chrome, working search results, retention/hold banners, provenance card, share dialog polish, key-status admin, AI.

---

## Phase 1 — trust made legible (Foundation, completes the tier)

Backend gate: key management + rotation, version UI (diff, provenance export), retention + legal-hold **enforcement** in the delete/tombstone path.

The shell is unchanged; the compliance surfaces deepen. This is where the "records tool" identity becomes real.

Ships / upgrades:

- **Version panel (§7.3) → full.** Adds **diff** between versions and **provenance export** (offline-verifiable bundle, footer `download`). Restore gains its confirm dialog copy ("Restore as new version"). The all-intact / verifying / tamper / single-version-empty states are all designed here.
- **Retention / legal-hold banner (§7.7)** — first appears, because enforcement now exists server-side. Held documents show the amber `gavel` banner; operations that violate a hold are **removed** from row/menu affordances (§7.2 disabled-held state), with a keyboard-path guard toast. Retention shows policy + eligible-purge date + tabular countdown; tombstone (`archive`) copy states bytes are retained.
- **Status cluster (§7.2)** gains the `gavel` "hold" chip and retention state.
- **Key-status badge (§7.6 `key`/`key-round` variant)** — a minimal, read-only surface in account/admin showing KEK/DEK/rotation state, never key material.
- **Toasts (§7.12)** gain the hold-skipped-batch pattern ("Moved 4 · 1 skipped (under hold)").

Foundation tier is complete when: encryption is ambient-and-permanent (§8.3), tamper is a loud alarm (§8.2), holds/retention are pre-action lockouts (§8.4), and the full hash chain is renderable and verifiable (§8.1) — all shipped, all tested.

---

## Phase 2 — editing arrives (Alpha)

Backend gate: embedded Sheet/Docs/PDF/Markdown editors over the app origin; save commits an encrypted, hash-chained version + audit event; real-time co-editing via `collab`.

The registry becomes a workspace. This is the first phase that adds a **new full-route surface** rather than deepening an existing panel.

Ships:

- **Editor chrome** — embedded-editor route: byte stream over the app origin, editor SDK mounted, save → new version. Chrome carries the ambient `lock` badge (§7.6) and the current version tag. One primary action discipline (§7.1) holds inside the editor frame.
- **Co-edit presence (§7.2 editing state)** — avatar stack + `pencil` glyph on rows and in the editor; live presence. Every save lands as an ordered version, surfaced in the (already-shipped) version panel.
- **Save/version feedback** — toasts ("Version 13 saved"), optimistic UI per §1.7, upload/save progress spinners (finite tasks).
- **Share dialog (§7.11 + §8.7)** — password (Argon2id) + expiry + revoke; recipient page is the minimal, cookieless, read-only chrome on the user-content origin with the `lock` badge and no app nav. (Share primitives are inherited from Casual Drive; this phase brings them to the Doc-Hub UI standard.)

Not yet: search results, provenance issuance, retention/legal-hold **admin** (Phase 1 shipped enforcement + banners; the management console is Phase 4), AI.

---

## Phase 3 — search goes live (Alpha, completes the tier)

Backend gate: `core` extraction → Tantivy full-text; lazy index worker; `index_state`; reindex-on-version; index-removal-on-tombstone.

The stubbed Command-K from Phase 0 finally does its job.

Ships:

- **Command-K content search (§7.1)** — the two-zone palette activates its content-search zone: Tantivy full-text, snippet + highlight, type/project/date filters, "which document mentions X". All palette states designed: empty (recent + shortcuts), typing (skeleton rows), results, no-results (registry motif), error.
- **Search-input lead/kbd chrome (§7.10)** — `search` icon + `⌘K` kbd chip, `/` to focus.
- **Index-state affordances** — a quiet indicator for documents still indexing (mirrors the `index_state` column); never blocks browsing.

Alpha tier is complete: a self-hoster can edit, version, co-edit, share, and search — end to end.

---

## Phase 4 — compliance console (Beta)

Backend gate: Ed25519 signing / issuer-registrar model; retention-policy + legal-hold **admin**; exportable audit + retention reports; optional transparency-log anchoring.

Phases 0–1 shipped compliance as *inline, per-document* surfaces (badges, banners, version panel). Phase 4 adds the *administrative and issuance* surfaces on top — the governance console.

Ships:

- **Provenance / signature card (§7.8)** — issuer, Ed25519 fingerprint (mono), signed-at, bound version hash; Verify action → intact/tamper badge; offline-verifiable export bundle. Unsigned state is neutral ("Not signed" + role-gated "Sign this version"). This is the DigiLocker-style registrar output surfaced in the UI.
- **Retention-policy + legal-hold admin UI** — the management console behind the Phase 1 enforcement: define policies, place/release holds, see what is under hold. The **legal-hold confirm dialog (§7.11)** — blocks tombstone, explains consequences, requires typed/checkbox confirm — lands here.
- **Audit + retention export (§7.4)** — the export affordance (JSONL / PDF, offline-verifiable) and full filter bar (actor/action/date/project) activate. Footer: "Append-only · hash-chained · N events."
- **Transparency-log / chain-head anchoring (optional)** — a quiet status surface for anchored chain heads, if enabled.

Beta tier is complete: audit and retention exports are hash-verifiable, and a registrar can issue a signed document a recipient verifies offline.

---

## Phase 5 — the intelligence layer (1.0)

Backend gate: `dochub-ai` — semantic search, summaries, PII/entity detection (suggestions), cross-document Q&A. Read-only, human-approved, audited; pluggable provider (default Claude via the Anthropic API, local-model option for air-gapped).

AI is added **without mutating the append-only reality** — the design rule (§1.10, §8.6) constrains every AI surface.

Ships:

- **Command-K AI block (§7.1)** — the read-only, suffixed "AI · read-only" (`sparkles`) block appears beneath content-search results. Never mutates; cross-document Q&A answers render here with source citations that link to the backing documents.
- **Summaries** — read-only document/section summaries in the version/detail panel, clearly labeled AI-generated, never written into a version.
- **PII / entity flags** — suggestion chips surfaced for human approval; approving is an explicit, audited action, never automatic.
- **AI provenance in audit (§7.4)** — every AI action appears in the audit trail (read-only, audited invariant).

1.0 tier is complete when the intelligence layer is live, every AI action is read-only and audited, and the whole surface has passed hardening (a11y, contrast, reduced-motion, keyboard-first per §9).

---

## Component → phase index

The single lookup table. "First ships" is the phase a component first appears; "completes" is where its full state matrix / advanced states land, if later.

| Component (ui-system.md) | First ships | Completes | Note |
|---|---|---|---|
| Design tokens, type, space, radii, motion, icons (§2–§6) | 0 | 0 | Landed once; consumed everywhere. a11y (§9) wired from the start. |
| App shell — sidebar/top bar/breadcrumb (§7.1) | 0 | 0 | |
| Command-K palette (§7.1) | 0 (stub) | 3 (content) / 5 (AI) | Opens in 0; search zone in 3; AI block in 5. |
| Document table row (§7.2) | 0 | 4 | Status cluster grows: lock/verify (0) → hold/retention (1) → co-edit (2) → signed (4). |
| Version-history + hash-chain (§7.3) | 0 (read+verify+restore) | 1 (diff, provenance export) | |
| Verification badge — intact/tamper (§7.5) | 0 | 0 | Alarm from first release. |
| Encryption/lock badge (§7.6) | 0 | 1 (key-status variant) | |
| Audit-trail row (§7.4) | 0 (read) | 4 (export + full filters) | |
| Buttons/inputs/dialogs/toasts/skeletons/empty (§7.9–7.13) | 0 | ongoing | Shared primitives; new dialog/toast variants per phase. |
| Editor chrome + co-edit presence (§7.2 editing) | 2 | 2 | |
| Share dialog + recipient page (§7.11, §8.7) | 2 | 2 | |
| Content search results + filters (§7.1, §7.10) | 3 | 3 | |
| Retention / legal-hold banner (§7.7) | 1 (enforcement) | 4 (admin console) | Banner in 1; management UI in 4. |
| Provenance / signature card (§7.8) | 4 | 4 | |
| Legal-hold confirm dialog (§7.11) | 4 | 4 | |
| Audit / retention export | 4 | 4 | |
| AI block, summaries, PII flags (§7.1, §8) | 5 | 5 | Read-only, audited, human-approved. |

---

## How compliance/security UI lands incrementally

Compliance is not a Phase 4 bolt-on — it is layered from the first release, matching where the *backend enforcement* exists (`ui-system.md §8`).

1. **Foundation (0–1): trust is visible per-document.** Encryption ambient + permanent (badge, sidebar footer chip). Chain integrity renderable and verifiable (version panel, per-link markers). Tamper a loud, non-dismissible alarm. Holds/retention as pre-action lockouts (banner + removed affordances). Audit trail readable and hash-chained. Everything here is *inline and passive* — the user sees and verifies, but does not administer.
2. **Alpha (2–3): trust survives editing and sharing.** Every save is a new hash-chained version (visible in the panel that already existed). Shares carry the isolated-origin, cookieless, password+expiry model. Search never bypasses compliance (Tantivy is keyword; nothing about search weakens the chain).
3. **Beta (4): trust becomes administrable and issuable.** The governance console — policies, holds, signing/provenance issuance, verifiable exports — sits *on top of* the inline surfaces from Foundation. The registrar/issuer (DigiLocker-style) output gets its provenance card.
4. **1.0 (5): intelligence without mutation.** AI reads and suggests; it never writes a version, never edits history, and every action is audited. The append-only invariant (§1.10) is the hard constraint on the newest layer.

The through-line: **a security surface ships in the same phase its enforcement lands, never before (nothing fake) and never late (nothing hidden).**
