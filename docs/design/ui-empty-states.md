# Doc-Hub — empty-state catalog

Companion to [`ui-system.md`](./ui-system.md). Every product surface gets a designed empty state. This document is the authoritative list. Where copy or tokens conflict, `ui-system.md` wins; this file only specializes it.

**Governing rule (Principle 12):** *Every surface has an empty state using the registry motif. Never a dead end.* An empty state is a state, not an accident — it explains where you are, what belongs here, and the one thing to do next. It is dense and quiet, not a marketing hero.

---

## 1. Anatomy — the shared empty-state block

One reusable component, `EmptyState`, drives every entry below. It is deliberately compact — a records tool does not do full-viewport heros.

```
        ╭─────────╮
        │  ▨▨▨    │   ← illustration: registry-motif (Lucide, 24px, --fg-subtle)
        │  ▨▨▨    │      three offset sheets = the logo stack
        ╰─────────╯
        Title                    ← --text-lg / 600 / --fg-default
        One-line explanation.    ← --text-sm / 500 / --fg-muted, ≤ 88ch
        [ Primary action ]  Secondary link   ← one primary max
```

### 1.1 Layout tokens

| Property | Token / value |
|---|---|
| Container | centered in the empty region, **not** full-viewport; `max-width: 420px` |
| Vertical stack gap | `--space-4` (16px) between illustration → title → body → actions |
| Outer padding | `--space-8` (32px) top, the ceiling — never larger |
| Illustration size | 24px glyph (empty-state size from §6.1), optical container ~64px |
| Illustration color | `--fg-subtle` (`#8A8A92`) at rest; **never** amber unless the state is an alarm |
| Title | `--text-lg` (16/22/600), `--fg-default` |
| Body copy | `--text-sm` (12/16/500), `--fg-muted`, centered, terse present tense |
| Secondary hint / shortcut | `--text-sm` (12/16/500), `--fg-subtle`, with `kbd` chips where a shortcut exists |
| Primary action | Primary button, `28px`, `--radius-sm`, `--accent` bg / `--accent-fg` — the one amber point on the surface |
| Secondary action | Ghost button or text link, `--fg-muted` |
| Background | inherits the surface it replaces (`--bg-surface` in tables, `--bg-raised` in panels); no card, no shadow |
| Motion | fade-in at `--dur-base` (180ms), opacity only; honors `prefers-reduced-motion` |

### 1.2 Illustration direction — the registry motif

- Base motif: the **document stack** (`ui-system.md` §6.2) — Lucide `layers` / `files`, echoing the logo's three offset sheets. This is the app signature; it appears in *every non-alarm* empty state so "empty" always reads as "empty **registry**", not "empty app".
- Rendered as a line drawing: 1.5px stroke, `currentColor` = `--fg-subtle`, on transparent. No fills, no gradients, no drop shadows. Monochrome-first (Principle 2).
- Each surface **specializes** the motif with one overlaid concept glyph from the security set (e.g. `search` for no-results, `shield-check` for chain-clean, `gavel` for no-holds). The overlay is small, bottom-right, same stroke, same `--fg-subtle` — except alarms, which switch to `--status-danger` (see §14).
- Never animate the illustration. Trust surfaces do not spring (Principle 9 / §5.4).
- Under `prefers-contrast: more`, promote illustration to `--fg-muted`.

### 1.3 Copy rules (inherit §1 Principle 15)

Terse, present tense, sentence case. State **what belongs here** and **the next action**. Never "Oops", never empty-cheerful ("Nothing to see!"). One localized italic line is permitted only for filtered/no-results (§4), per §3.2.

---

## 2. Catalog index

| # | Surface | Motif overlay | Primary action | Tone |
|---|---|---|---|---|
| 3 | Empty vault / personal locker | `lock` | Upload documents | calm |
| 3 | Empty project | `layers` | Add documents | calm |
| 4 | No documents in folder | `file-text` | Upload / New | calm |
| 5 | No search results | `file-search` | Clear / broaden | neutral |
| 6 | No versions yet (single version) | `git-commit-horizontal` | — (informational) | reassuring |
| 7 | Empty audit trail | `scroll-text` | — / Adjust filters | neutral |
| 8 | No legal holds | `gavel` | Place hold (role-gated) | calm |
| 9 | No shares | `share-2` | Create share link | calm |
| 10 | First-run (fresh workspace) | `layers` | Create project / Upload | welcoming-terse |
| 11 | Permission denied | `lock` | Request access | firm |
| 12 | Error / offline | `unlink` / `cloud-off` | Retry | firm |
| 13 | Chain verified clean | `shield-check` | Export bundle | reassuring |
| 14 | Tamper detected (anti-empty) | `shield-alert` | Open audit / affected version | **alarm** |

---

## 3. Empty vault (personal locker) & empty project

Two closely-related container-empty states.

### 3.1 Personal locker — empty

- **Illustration:** stack motif + `lock` overlay (`--fg-subtle`). Signals *private, encrypted, yours*.
- **Title:** `Your locker is empty`
- **Body:** `This is your private, encrypted space. Documents you add here are versioned and hash-chained from the first upload.`
- **Primary:** `Upload documents` (`upload` icon) → file picker, respects the ingest allowlist.
- **Secondary:** `New document` ghost (`file-text`) → native editor create.
- **Hint:** `Drag files anywhere, or press` `⌘U`. Sub-line: `Accepts docx, xlsx, pptx, pdf, md, txt, csv, json, yaml.`
- **Tokens:** title `--text-lg`; body `--fg-muted`; the always-on `lock` + "Encrypted at rest · AES-256-GCM" sidebar-footer chip (§7.6) stays visible, reinforcing that empty ≠ unprotected.

### 3.2 Project — empty

- **Illustration:** stack motif + `layers` overlay.
- **Title:** `No documents in {Project}`
- **Body:** `Add the first document to start its permanent history. Every version is chained; nothing is ever overwritten.`
- **Primary:** `Add documents` (`upload`).
- **Secondary:** `New document` ghost; and, role permitting, `Invite members` text link (`user-plus`).
- **Disabled variant (viewer/no-write role):** primary is **removed**, not greyed (§7.2 hold pattern reused). Replace with body `You have view access to {Project}. There is nothing here yet.` + secondary `Request upload access` → §11 flow.
- **Tokens:** left-rule + `--bg-selected` only if reached via a selected sidebar item; otherwise plain `--bg-surface`.

---

## 4. No documents in folder

Distinct from an empty project: the container exists and has siblings.

- **Illustration:** stack motif + `file-text` overlay.
- **Title:** `This folder is empty`
- **Body:** `Upload a document or create one here. It inherits {Folder}'s permissions and retention.`
- **Primary:** `Upload` (`upload`).
- **Secondary:** `New document` ghost; `New folder` text link.
- **Hint:** `⌘U` to upload · `⌘N` new. `kbd` chips `--text-sm` `--fg-subtle`.
- **Tokens:** rendered inside the table body region (`--bg-surface`), replacing rows; the toolbar (`+ New`, `↑ Upload`) stays live above so the surface is never a dead end even if the block’s primary is missed.

---

## 5. No search results

Command-K content search (Tantivy) and in-table filter share this state.

- **Illustration:** stack motif + `file-search` overlay (`search`).
- **Title:** `No matches for "{query}"`
- **Body (italic line permitted, §3.2):** *No documents contain "{query}".* Then plain: `Search covers full document text, not just names.`
- **Primary:** `Clear search` (secondary-weight button; there is no creative primary here — do not invent one).
- **Secondary paths (as inline suggestions, each a ghost row):**
  - `Search all projects` (if scoped) — `folder-search`
  - `Match names only` toggle
  - `Ask AI` (`sparkles`) — routes to the read-only "AI · read-only" block (§7.1); labeled, never mutates.
- **Filtered-empty variant (filters applied, query blank):** Title `No documents match these filters`; Body `Try widening the date range or clearing an actor.`; Primary `Clear filters`. Show active filter chips above so the cause is legible.
- **Tokens:** in command-K, render inside the `--bg-raised` modal at `--radius-lg`; illustration 24px (empty-state scale) to fit the 560px palette. Body `--text-sm`; the query echoes back in mono where it is a hash-shaped token (`--mono-sm`).

---

## 6. No versions yet (single version)

Not truly empty — one version exists. This is the "history begins" state from §7.3.

- **Illustration:** single node on a short chain stub — `git-commit-horizontal` filled `●`, `--fg-subtle`. Motif reads as *the first sheet of the stack*.
- **Title:** `One version. History begins here.`
- **Body:** `v1 is the origin of this document's chain. Each edit appends a new version and links to this hash — nothing is replaced.`
- **Inline proof:** show `content_hash 9f3a…c1` in `--mono-sm` + copy glyph `⧉`; `shield-check` "Verified" inline badge (`--status-verified`) — a one-link chain is trivially intact and we say so.
- **Primary:** none — this is informational, not actionable. Do **not** fabricate a CTA.
- **Secondary:** `Verify chain` ghost (runs even for one link, resolves instantly to intact) and `Export bundle` text link (`download`).
- **Tokens:** rendered in the 360px right-docked version panel (`--bg-raised`); illustration 24px; footer stays `Chain: 1 version · ✓ 1 link verified · Append-only`.

---

## 7. Empty audit trail

From §7.4 states.

- **Illustration:** stack motif + `scroll-text` overlay; convey the append-only ledger.
- **Title (unfiltered):** `No activity yet`
- **Body:** `Every action — upload, edit, sign, hold, restore — is recorded here, append-only and hash-chained. The log starts with your first change.`
- **Primary:** none (the audit log is a consequence, not an action). Offer `Upload a document` ghost **only** if the whole workspace is fresh (first-run overlap, §10); otherwise no CTA.
- **Filtered-empty variant:** Title `No events match these filters`; Body `Adjust the actor, action, date range, or project.`; Primary `Clear filters`; keep active filter chips visible.
- **Tokens:** replaces the day-grouped rows in the audit region (`--bg-surface`); footer persists `Append-only · hash-chained · 0 events`. `Export` control stays present but disabled at 40% opacity (nothing to export), tooltip `No events to export yet.`

---

## 8. No legal holds

Compliance surface — an empty holds list is a *good* state, framed calmly.

- **Illustration:** stack motif + `gavel` overlay, `--fg-subtle` (not amber — nothing is on hold, so no attention signal; per §2.7 amber would falsely imply an active hold).
- **Title:** `No active holds`
- **Body:** `No documents are under legal hold. Placing a hold blocks deletion, tombstoning, and purge until it is released.`
- **Primary (role-gated, admin/legal only):** `Place a hold` (`gavel`) → hold dialog (§7.11 legal-hold confirm).
- **Secondary:** `Learn how holds work` text link → docs; `View released holds` (`history`) if any exist.
- **Non-privileged role:** primary removed; body ends `Ask a workspace admin to place one.`
- **Tokens:** illustration `--fg-subtle`, **never** `--status-attention` here — amber is reserved for a real hold banner (§7.7). The moment a hold exists, this surface switches to the amber `gavel` banner list, not this empty block.

---

## 9. No shares

Share management for the isolated user-content origin (§8.7).

- **Illustration:** stack motif + `share-2` overlay.
- **Title:** `No share links`
- **Body:** `Nothing is shared outside the workspace. Share links are read-only, live on the isolated content origin, and can carry a password and expiry.`
- **Primary:** `Create share link` (`link-2`) → share dialog (password Argon2id + expiry + revoke).
- **Secondary:** `About share security` text link.
- **Copy guardrail:** state isolation plainly — reassure that empty = *nothing is exposed*. Do not over-warn.
- **Tokens:** each future share row carries a `lock` badge; the empty block previews that trust posture in copy. Primary is the single amber point.

---

## 10. First-run (fresh workspace)

The workspace-level zero state — no projects, no locker contents, no activity. Highest-stakes empty state; still terse.

- **Illustration:** the full three-sheet stack motif at its cleanest (`layers`), no overlay — this **is** the app’s signature mark, doubling as the splash motif (§6.2). Slightly larger optical container (still ≤ 64px, still `--fg-subtle`).
- **Title:** `Welcome to Doc-Hub`
- **Body:** `A permanent, encrypted home for your documents. Add one to begin its versioned, hash-chained history.`
- **Primary:** `Upload documents` (`upload`).
- **Secondary:** `Create a project` ghost (`folder-plus`) · `New document` text link.
- **Orientation strip (below actions, `--text-sm` `--fg-subtle`, three inline items with icons):**
  - `lock` `Encrypted at rest`
  - `link` `Every version chained`
  - `scroll-text` `Full audit trail`
  These are ambient trust cues, not steps — no numbered wizard, no confetti.
- **Tokens:** occupies the content region (`--bg-canvas`), sidebar + top bar already populated. `⌘K` hint present: `Press ⌘K to search or run a command.` The encryption sidebar chip is already on — the product is protective from the first pixel.

---

## 11. Permission denied

Not empty — *withheld*. Firm, non-blaming, always offers a path (never a dead end, Principle 12).

- **Illustration:** stack motif + `lock` overlay; keep it `--fg-subtle`, not danger — denial is a boundary, not a tamper alarm. (Distinguished from encryption `lock` by the accompanying label.)
- **Title:** `You don't have access to {resource}`
- **Body:** `This {document/project} is restricted. Your current role is {role}. Ask an owner for access — the request is logged.`
- **Primary:** `Request access` (`user-plus` / `mail`) → sends a request to resource owners, writes an audit event.
- **Secondary:** `Back to {parent}` ghost · `Switch account` text link (if multi-account).
- **403 vs 404 posture:** for existence-sensitive resources, copy stays generic (`This isn't available to you`) to avoid leaking existence — align with `docs/research/06-security.md`.
- **Tokens:** `--fg-default` title, `--fg-muted` body; **no** `--status-danger` — reserve brick strictly for integrity outcomes (§2.5). `role="status"`, not `alert`.

---

## 12. Error / offline

System failure state. Firm, states *what* and *what next* (Principle 15); never "Oops".

- **Illustration:** stack motif + `unlink` overlay for load failures, or `cloud-off` for offline; `--fg-muted` (not brick — a fetch failure is not tamper).
- **Title (load error):** `Couldn't load {surface}`
- **Body:** `The request failed. This is on our side, not your data — your documents and their history are intact.`
- **Primary:** `Retry` (`rotate-cw`) → re-runs the fetch; shows inline spinner (finite system task, §7.13) while retrying.
- **Secondary:** `Reload app` · `Copy error details` (`copy`) → mono error code + `jti` for support.
- **Offline variant:** Title `You're offline`; Body `Reconnect to load and save. Unsaved edits are held locally and sync when you're back.`; Primary `Retry`; a persistent top-bar offline chip (`cloud-off`, `--fg-subtle`) mirrors state. Auto-retry on `online` event.
- **Reassurance is load-bearing:** because immutability is the product, error copy explicitly affirms data integrity so a transient failure never reads as loss.
- **Tokens:** `role="alert"` `aria-live="assertive"` for hard errors; error code in `--mono-sm`; `--status-danger` used **only** if the failure is a genuine integrity/verification error (then it escalates to §14), otherwise neutral `--fg-muted`.

---

## 13. Chain verified — clean

The positive outcome of `verify_chain`. Quiet by design (Principle 8: verified is calm; §5 "trust surfaces do not spring").

- **Illustration:** stack motif + `shield-check` overlay in `--status-verified` (`#2F6B4F` light / `#5FA07E` dark) — the *one* place an empty/result state uses the verified hue, and it always carries the label.
- **Title:** `Chain verified — no tampering`
- **Body:** `All {n} versions link cleanly. Each content_hash matches its recorded prev_hash.`
- **Inline proof:** `✓ {n} links verified · 0 broken`, tabular; per-version `content_hash` list available on expand, mono.
- **Primary:** `Export offline-verifiable bundle` (`download`) — turns the clean result into a portable artifact.
- **Secondary:** `Re-verify` ghost (`shield-check`) · `View in audit` text link.
- **Tokens:** verified badge block variant (§7.5), `--status-verified` fg, transparent bg, `--border-hair`, `--radius-xs`. No fill wash — intact is quiet. `aria-live="polite"`. Motion `--dur-base`, no bounce.

---

## 14. Tamper detected — the anti-empty state

A broken chain or failed signature check. **This is an alarm, not an empty state** (Principle 9, §8.2) — included here because it is what a compliance surface shows *instead of* a clean/empty result, and it must never be styled like a quiet zero state.

- **Illustration:** stack motif with the chain visibly **broken** — `unlink` / `shield-alert` overlay in `--status-danger` (`#A32C22` light / `#D6685C` dark). This is the only empty/result illustration that leaves `--fg-subtle` for a chroma.
- **Title:** `Tamper detected`
- **Body:** `Verification failed between {vN} and {vN-1}. The recorded prev_hash does not match. This break is not repaired automatically — it is preserved for investigation.`
- **Proof:** show both hashes in `--mono-sm`, the mismatch highlighted; `⛓✗ {vN} → {vN-1} LINK BROKEN`.
- **Primary:** `Open affected version` (`git-commit-horizontal`) → jumps to the version node.
- **Secondary:** `View audit entry` (`scroll-text`) · `Export evidence bundle` (`download`).
- **Behavior (non-negotiable):**
  - Persistent block-level alert; **cannot be dismissed without resolution** (§7.5 tamper variant).
  - `role="alert"` `aria-live="assertive"`.
  - Names the affected version(s); links to the audit entry; never auto-repairs (append-only invariant).
- **Tokens:** `--status-danger` fg, bg `rgba(163,44,34,0.08)` light / equivalent dark wash, `1px solid --status-danger` border, left rule 3px `--status-danger`, `--radius-md`, padding `--space-3`. Icon `shield-alert` + label always both present — never color-only.

---

## 15. Cross-cutting rules

1. **One primary, max.** Each block has at most one amber primary (Principle 5). Informational states (§6, §7, §8-non-privileged) may have **zero** — do not manufacture a CTA to fill space.
2. **Registry motif everywhere.** Every non-alarm block uses the document-stack motif with a specializing overlay (Principle 12 / §6.2). Alarms (§14) break the calm palette on purpose.
3. **Amber only when it means something.** Illustrations rest at `--fg-subtle`. Amber appears only where a real attention state exists — never decoratively in an empty state (§2.7). No active holds → grey `gavel`, not amber.
4. **Never a dead end.** Every block offers a next step: an action, a filter reset, a request-access path, or a retry. Even §14 links forward (audit, affected version, export).
5. **Copy affirms immutability.** Where relevant (empty locker, single version, error, tamper), copy reminds the user that history is append-only and data is intact — trust is shown, not stated (§1 preamble).
6. **Accessibility (§9).** Non-alarm blocks are `role="status"` `aria-live="polite"`; tamper and hard errors are `role="alert"` `aria-live="assertive"`. Illustrations are decorative → `aria-hidden`; the concept is carried by the title text. Focus lands on the primary action when a block replaces interactive content. Hashes carry full-value `aria-label`, not the truncated visual.
7. **Motion (§5.4).** Fade-in `--dur-base`, opacity only; illustrations never animate; `prefers-reduced-motion` → instant fade. Trust surfaces do not spring.
8. **Density (§4).** Blocks are `max-width: 420px`, top padding capped at `--space-8` (32px). No full-viewport heros — this is a records tool.

---

*Companion to `ui-system.md`. Both supersede `docs/research/04-polish-principles.md` where they conflict.*
