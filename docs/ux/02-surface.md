# 02 — UI Surface Spec

The visual layer beneath the flows in [`01-flows.md`](./01-flows.md). For each surface: ASCII layout, the components and tokens that build it, every state it can be in, the keyboard model, and the motion. Still no pixel mockups — that's Figma or the implementation, this is the bridge.

Calibration: everything draws from the token set + libraries in [`../research/04-polish-principles.md`](../research/04-polish-principles.md). When a spacing/radius/colour value appears, it cites the token (`--space-3`, `--radius-md`, `--bg-elevated`). Components reference Radix Primitives, shadcn/ui patterns, cmdk, vaul, sonner, and Lucide.

Doc-Hub is a document registry, not a Finder/Drive. The surface is **projects → documents**, each document carrying a **version chain** and **encryption/lock** state. There are **no thumbnails, no media UI, no gallery** — a document glyph, a type label, a version, and provenance/lock badges.

Cross-cutting:
- All spacing snaps to the 4/8 grid.
- Concentric corners: container `--radius-lg` (12 px) with `--space-3` (12 px) inner padding → inner element `--radius-xs` (4 px).
- Hairline borders use `--border-default`.
- Focus uses `:focus-visible` only; the global focus ring token is `--focus-ring`.
- Every surface has a dark-mode variant.

## Contents

1. App shell (window, top bar, sidebar, main pane, footer hooks)
2. Sidebar (projects + system)
3. Top bar (content search)
4. Breadcrumbs + sort header
5. Document list view (with version + lock/verified badges)
6. Empty states
7. Selection bar
8. Command palette (content search)
9. Version-history panel
10. Modals
11. Toasts
12. Drop zones + inline upload row
13. Sign-in card
14. Recipient share page
15. Editor + provenance affordances

---

## 1 — App shell

```
┌──────────────────────────────────────────────────────────────────────┐
│ 🛡 Doc-Hub                                            ⌘K   👤    │  ← top bar (48px)
├────────────┬─────────────────────────────────────────────────────────┤
│            │ Compliance 2026 › Contracts › 2026                      │  ← breadcrumbs (40px)
│ PROJECTS   │ ┌ Name ─────────── Modified ─ Size ─ Type ─ Ver ┐  ▭   │  ← sort header (36px)
│ ▸ Personal │ ├───────────────────────────────────────────────────┤   │
│ ▸ Compliance│ │ 📄 Master agreement.docx  2h ago  42KB Doc  v4 🛡 │   │  ← main pane
│ ▸ Finance  │ │ 📄 NDA.pdf   🔒            yest.  310KB PDF  v2    │   │
│            │ │ 📄 Vendors.xlsx           last wk  88KB Sheet v7 │   │
│ SYSTEM     │ │ ...                                               │   │
│ Activity   │ │                                                   │   │
│ Trash      │ └───────────────────────────────────────────────────┘   │
│ Settings   │                                    [Indexing 3 docs 40%] │  ← footer pill (32px)
└────────────┴─────────────────────────────────────────────────────────┘
   248px                 auto
```

**Layout.**

- Three columns: sidebar (248 px expanded / 52 px collapsed), main pane (fluid), no right panel by default — the version-history panel (§9) slides in over the right edge when invoked.
- Top bar: 48 px, sticky, `--bg-default`, hairline bottom border.
- Sidebar: full height, `--bg-canvas`, hairline right border.
- Main pane: `--bg-default`.
- Footer pill: floating bottom-center, only during a background job (indexing, large upload aggregate). `--bg-elevated`, `--shadow-md`, `--radius-full`.

**Sizing.**

| Surface | Token |
|---|---|
| Top bar height | 48 px |
| Sidebar width (expanded) | 248 px |
| Sidebar width (collapsed) | 52 px |
| Main pane padding | `--space-6` (24 px) |
| Footer pill height | 32 px |

**Responsive.** ≥1024 px as above; 720–1023 px sidebar starts collapsed; <720 px sidebar becomes a vaul drawer, list compacts to stacked rows (design hook only).

**Motion.** Sidebar collapse 200 ms `--ease-out`; theme flip 250 ms colour interpolation.

---

## 2 — Sidebar (projects + system)

```
┌────────────────┐
│ 🛡 Doc-Hub │  ← brand row, 48px
├────────────────┤
│ ＋ New ▾        │  ← New project / Upload / New folder
│                │
│ PROJECTS       │  ← section label
│ ▸ Personal 🔒  │  ← personal locker (never deletable)
│ ▸ Compliance   │  ← active: --bg-selected, 2px accent stripe
│ ▸ Finance      │
│                │
│ SYSTEM         │
│ 🕒 Activity    │
│ 🗑  Trash  (3) │  ← tombstone count
│ ⚙  Settings    │
├────────────────┤
│ 🛡 Encrypted   │  ← encryption status chip
│ 👤 A           │  ← avatar menu
└────────────────┘
```

**Sections (top to bottom).**

1. **Brand row** (48 px). Lucide `shield` glyph (20 px, `--accent`) + wordmark. Click → root.
2. **+ New ▾.** Split button. Dropdown: **New project** · **Upload documents** · **New folder**.
3. **Projects.** Section label **"PROJECTS"** (`--text-xs`, uppercase, muted). Rows for the Personal locker (with a `lock` glyph, never deletable) and each team project. Row = 32 px, glyph + name, optional member-count on hover. Disclosure chevron expands the project's top-level folders.
4. **System.** **"SYSTEM"** label. Items: **Activity**, **Trash** (`(N)` tombstone badge), **Settings**.
5. **Encryption status chip.** Pinned above the avatar: `shield` glyph + **"Encrypted"** (`--success` when a key/KMS is active — always, since boot requires one). Tooltip: **"Documents are encrypted at rest (AES-256-GCM)."** Read-only; there is no toggle.
6. **Avatar.** 40 px monogram. Menu: **Account**, **Settings**, separator, **Sign out** (`⇧⌘Q`).

**Row states.**

| State | Visual |
|---|---|
| Default | transparent, `--fg-default` label, `--fg-subtle` glyph |
| Hover | `--bg-hover` |
| Active | `--bg-selected`, 2 px `--accent` left stripe, `--accent` glyph |
| Focus-visible | `--focus-ring` |
| Drop-target (upload into project/folder) | `--accent-muted`, dashed 1 px `--accent` |

**Collapsed state.** 52 px, glyphs only, tooltips (250 ms). Encryption chip collapses to the `shield` glyph. Toggle `⌘\`.

**Keyboard.** `⌘\` collapse; `⌘1`–`⌘9` jump to projects/system items.

---

## 3 — Top bar (content search)

```
┌──────────────────────────────────────────────────────────────────────┐
│ 🛡 Doc-Hub    │ ┌ 🔍 Search inside your documents… ┐ │  ⌘K   👤 │
└──────────────────────────────────────────────────────────────────────┘
```

**Layout.**

- 48 px, sticky.
- Left: brand mirror (only when sidebar collapsed).
- Center: content-search trigger — a faux-input that opens the command palette (§8). Placeholder **"Search inside your documents…"**. `search` glyph left, `⌘K` chip right. This searches *content*, not just names.
- Right: avatar (duplicated only when sidebar collapsed).

**States of the trigger.** Default `--bg-subtle` + hairline; hover `--bg-hover` + `--border-strong`; focus/open `--bg-default` + `--accent` border + `--shadow-sm`.

**Polish.** The `⌘K` chip is documentation, not a button.

---

## 4 — Breadcrumbs + sort header

```
Compliance 2026 › Contracts › 2026                                    [List]
─────────────────────────────────────────────────────────────────────────────
Name ▲            Modified          Size          Type        Version
```

**Breadcrumbs.** 40 px band, `--bg-default`, hairline below. First segment is the **project**; the rest are folders. Current segment `--fg-default`, prior `--fg-muted`, `›` separators. Middle truncation via a `…` dropdown.

**Sort header.** 36 px, sticky. Columns: **Name** (flex), **Modified** (160 px), **Size** (96 px, right-aligned, tabular), **Type** (120 px), **Version** (72 px, right-aligned, tabular — shows the head `vN`). Active sort shows ▲/▼. No thumbnail/preview column. List view only in v0 (no grid/gallery — a registry, not a media browser).

---

## 5 — Document list view

```
│ 📄  Master agreement.docx   2h ago    42 KB   Doc     v4  🛡 │  ← 32px, verified badge
│ 📄  NDA.pdf          🔒     yesterday 310 KB  PDF     v2     │  ← legal hold lock
│ 📄  Vendors.xlsx            last week 88 KB   Sheet   v7     │
│ 📄  notes.md         [Ask]  3 days    4 KB    Markdown v1    │  ← AI affordance on hover
│ ⌫   Old draft.docx (indexing) …       12 KB   Doc     v1     │  ← ingest / indexing ghost
```

**Row.**

- 32 px, `--space-3` left / `--space-4` right padding.
- Layout: type glyph (16 px Lucide) → name (`--text-sm`, `--weight-medium`, truncate) → status badges (lock / verified / AI) → spacer → modified (`--fg-muted`) → size (tabular, right) → type label (`--fg-muted`) → **version** badge (`vN`, tabular, right).
- Type glyphs come from a small documents-only table: document, spreadsheet, presentation, pdf, markdown, text, csv, json, yaml, folder. No image/video/audio/archive icons — those types never enter the hub.

**Row states.**

| State | Visual |
|---|---|
| Default | transparent |
| Hover | `--bg-hover`; reveals the **AI [Ask]** chip (when `dochub-ai` enabled) and the row overflow menu |
| Focused (keyboard) | `--bg-hover` + outset focus ring |
| Selected | `--bg-selected`, 2 px `--accent` left stripe |
| On legal hold | `lock` glyph before the name, `--warning` tint; trash action hidden |
| Provenance-verified | `shield-check` badge after the name, `--success` |
| Chain-broken (tamper) | `alert-triangle` badge, `--danger`; row tinted `--danger-muted` |
| Uploading / ingesting | ghost row 60% opacity, thin determinate progress bar (2 px, `--accent`), `upload-cloud` overlay; rejected → `--danger-muted` + tooltip |
| Indexing | muted **"(indexing)"** after the name until `index_state = ready` |
| Editor session active | `Editing` badge (`--bg-accent-muted`, `--accent`) after the name |

**Version badge.** Always the head `vN`. Click opens the version-history panel (§9). Tooltip: **"v4 · saved 2h ago · verified chain"**.

**Inline rename.** Name cell → input matching row typography; extension stays inline muted, non-editable. Renaming is metadata-only and audited; it does **not** create a version.

**Keyboard.** `↑↓` focus, `Cmd-A` select all, `Enter` open, `F2` rename, `Backspace`/`Delete` trash (tombstone), `H` history, `Esc` clear.

**Motion.** FLIP reflow on insert/tombstone (200 ms `--ease-out`); selection toggle instant; progress frame-locked to real events.

**Virtualisation.** `@tanstack/react-virtual` above 100 rows; fixed 32 px height.

---

## 6 — Empty states

Pattern: centred column, ~480 px, vertical flow, 56 px Lucide glyph in `--fg-subtle`, never animated.

| Surface | Title | Subtitle | CTA |
|---|---|---|---|
| No projects yet | "Create your first project." | "Projects hold your documents — a team space or your personal locker." | New project (primary) |
| Empty project | "This project has no documents yet." | "Upload documents, or create one." | Upload (primary) |
| Empty folder | "This folder is empty." | "Drop documents to add." | — |
| Search (no results) | "No documents match \"<q>\"." | "Search reads inside documents, not just names." | Clear search |
| Trash (empty) | "Trash is empty." | "Trashed documents are retained under policy, then purged." | — |
| Activity (empty) | "Nothing here yet." | "Actions in this hub will appear here." | — |

**Polish.** No tutorial overlay; fade in 200 ms after mount.

---

## 7 — Selection bar

```
                          ┌─────────────────────────────────────────────┐
                          │ 3 selected   ⬇ Download   🔗 Share   → Move │
                          │              🗑 Trash                    ×  │
                          └─────────────────────────────────────────────┘
```

- Bottom-centered, inset 24 px, vaul drawer (persistent until cleared), `--bg-elevated` 80% + `backdrop-filter`, `--radius-xl`, `--shadow-lg`.
- Contents: **"N selected"** → action chips (**Download**, **Share…**, **Move…**) → hairline → **Trash** (`--danger` text) → spacer → **Clear** (×).
- Actions that can't apply to a mixed selection are hidden, not greyed. Trash respects legal hold (held docs are skipped, noted in the toast).
- Motion: slide up 200 ms `--ease-out`; `Esc` dismiss.

---

## 8 — Command palette (content search)

```
┌──────────────────────────────────────────────────────────────┐
│ 🔍 Search inside your documents…                        Esc │  ← input, 56px
├──────────────────────────────────────────────────────────────┤
│ DOCUMENTS                                                    │
│   📄 Master agreement.docx   "…termination within 30 days…"  │  ← content snippet + path
│                              Compliance › Contracts     v4   │
│   📄 Vendors.xlsx            "…net-30 payment terms…"        │
│ ─────                                                        │
│ COMMANDS                                                     │
│   ＋ New project                                     ⌘⇧P    │
│   ⬆ Upload documents                                 U      │
│   📤 Export audit report                                    │
│   🌗 Toggle theme                                    ⌘⇧L    │
└──────────────────────────────────────────────────────────────┘
```

- 600 px, top-aligned 120 px from viewport top, `--radius-xl`, `--shadow-xl`, cmdk under the hood.
- **Documents** section shows **content** hits (Tantivy full-text over `core`-extracted text): a highlighted **snippet**, the project/folder path, and the matching version. Filter chips (Type / Project / Date) sit under the input. When `dochub-ai` is on, an **Ask** tab runs semantic search + Q&A (read-only, cited).
- **Commands** section: actions with chord chips.
- States: Initial → Recent documents + all commands; Query → content matches (up to 8) + command matches; No results → **"No documents match \"<q>\"."**; Loading → 4 skeleton rows.
- Motion: 150 ms open, calm, no bounce.

---

## 9 — Version-history panel

```
┌─ Version history ── Master agreement.docx ──────────── ✕ ─┐
│ 🛡 Chain verified · 4 versions                            │
│ ─────────────────────────────────────────────────────    │
│ ● v4  You            2h ago    42 KB   #9f3c…   [View]    │  ← head
│ ○ v3  Sam            yesterday 41 KB   #1a77…   [View][D] │
│ ○ v2  You            3 days    40 KB   #c40e…   [Restore] │
│ ○ v1  You (upload)   last week 38 KB   #77b2…            │
│ ─────────────────────────────────────────────────────    │
│  [ Diff v2 ↔ v4 ]              [ Export provenance ]      │
└───────────────────────────────────────────────────────────┘
```

- Slides in over the right edge (360 px, `--bg-elevated`, `--shadow-lg`) or opens as a Dialog on narrow viewports.
- Header: document name + **chain-verified** badge (`shield-check`, `--success`) when `verify_chain` passes; **tamper** banner (`alert-triangle`, `--danger`) when it fails — loud, with **"Chain verification failed at v3. An admin has been notified."**
- Each version row: `seq` dot (filled for head), author, relative time, size, `content_hash` prefix (`--font-mono`), and actions: **View** (read-only in the embedded editor), **Diff** (select two, or version↔head), **Restore** (appends a new head byte-equal to the chosen version — never destructive; inline confirm **"Restore v2? This adds a new version — nothing is lost."**).
- **Diff** stage: text/markdown line diff, `.xlsx` changed-cells, `.docx` tracked prose, `.pdf` page-level add/remove/change — all derived from `core`, read-only.
- **Export provenance**: downloads the chain (hashes + Ed25519 signature + version bytes reference) for offline verification.
- States: Loading (skeleton rows) · Default · Verified · Tamper-detected (restore disabled until admin ack) · Diff-active.
- Keyboard: `↑↓` move, `Enter` view, `D` diff-select, `R` restore, `Esc` close.

---

## 10 — Modals

Radix Dialog throughout. Backdrop `rgba(0,0,0,0.40)` + 2 px blur. Esc + outside click dismiss, except destructive confirms.

### 10.1 New project

```
┌──────────────────────────────────────────┐
│ New project                          ✕   │
│ Name        [___________________]        │
│ Description [___________________] (opt.) │
│ A team project — you'll be the Owner.    │
│                        [Cancel] [Create] │
└──────────────────────────────────────────┘
```

### 10.2 Move to… picker

```
┌──────────────────────────────────────────┐
│ Move 3 documents to…                 Esc │
│ 🔍 Search folders                        │
│ ▸ Compliance 2026                        │
│   ▸ Contracts                            │
│     • 2026     ← cursor                  │
│ ▸ Personal                               │
│                     [Cancel] [Move here] │
└──────────────────────────────────────────┘
```

Move is within/between projects the user can write to; documents keep their full version chain.

### 10.3 Share modal

See [`05-sharing-surface.md`](./05-sharing-surface.md). Link card (`--accent-muted` bg + `--accent` border), collapsible options (Permission / Expires / Password), existing-links list. Copy shows an inline check, no toast.

### 10.4 Legal-hold / delete confirm

```
┌──────────────────────────────────────────┐
│ This document is on legal hold.          │
│ It can't be moved to trash or purged     │
│ until the hold is released.              │
│                                [   OK   ] │
└──────────────────────────────────────────┘
```

There is **no** "permanently delete now" modal for documents — purge is governed by retention policy server-side, never a user gesture. The only destructive-looking confirm is releasing a legal hold (admin, audited).

**Modal cross-cutting.** Focus trap; first interactive element focused on open; focus returns to trigger on close.

---

## 11 — Toasts

sonner, top-right, max 3 visible.

```
┌─────────────────────────────────────────────────┐
│ ✓ Restored v2 as v6.                        ✕   │
└─────────────────────────────────────────────────┘
```

| Variant | Glyph | Colour | Use |
|---|---|---|---|
| Success | `check-circle-2` | `--success` | "Uploaded N documents.", "Restored v2 as v6.", "Saved as v4." |
| Info | `info` | `--info` | "Signed out for security." |
| Warning | `alert-triangle` | `--warning` | "3 documents were rejected." |
| Error | `alert-circle` | `--danger` | "Couldn't upload. Try again." |

Lifetime: 4 s default, 8 s with Undo, 6 s error. Verb-first, terse, no exclamation marks.

---

## 12 — Drop zones + inline upload row

### Window-wide drop zone

```
╔══════════════════════════════════════════════════════╗
║                  ┌──────────────────┐                ║
║                  │   ⬆               │                ║
║                  │ Drop documents   │                ║
║                  │  into Contracts  │                ║
║                  └──────────────────┘                ║
╚══════════════════════════════════════════════════════╝
```

Canvas dims 120 ms; dashed 2 px `--accent-muted` card, `upload-cloud` 32 px, caption names the destination. Non-document types are rejected on drop with a per-batch toast (§11 Warning) — the drop card never implies "anything goes".

### Inline ingest row

The §5 uploading/ingesting row state — ghost row, determinate progress, resolves to a **v1** document on 201, then shows **"(indexing)"** until searchable.

---

## 13 — Sign-in card

```
                  ╭─────────────────────────────╮
                  │            🛡               │
                  │      Doc-Hub           │
                  │   Sign in to continue.      │
                  │   ┌────────────────────┐    │
                  │   │ Username           │    │
                  │   └────────────────────┘    │
                  │   ┌────────────────────┐    │
                  │   │ Password           │    │
                  │   └────────────────────┘    │
                  │   [        Sign in       ]  │
                  │   ── or ──                  │
                  │   [   Sign in with SSO   ]  │  ← only if OIDC configured
                  ╰─────────────────────────────╯
```

- 360 px, centred, `--radius-xl`, `--shadow-md`, hairline. Lucide `shield` 28 px `--accent`.
- Username + password inputs; **Sign in with SSO** (OIDC Auth Code + PKCE) shown only when an IdP is configured.
- Caps-lock helper; shake-on-error (8 px, 250 ms, 1 cycle). Error **"Wrong username or password."**
- Solid `--bg-canvas` background, no marketing imagery.

---

## 14 — Recipient share page

```
                  ╭──────────────────────────────╮
                  │       📄                     │  ← document type glyph 56px
                  │   Q2 planning.xlsx           │
                  │   Spreadsheet · 28.4 KB      │
                  │   Shared by owner            │
                  │   [  Open read-only   ]      │  ← previewable documents
                  │   [  Download         ]      │
                  ╰──────────────────────────────╯
                          Powered by Doc-Hub
```

- Stripped of hub chrome. 440 px card. Document formats only — no media preview. Bytes come from the user-content origin.
- Password gate variant: `lock` glyph, single input, **Continue**. Expired/revoked/not-found all show **"This link is no longer active."** (anti-enumeration).
- Footer **"Powered by Doc-Hub"**, operator opt-in (`DOCHUB_RECIPIENT_FOOTER=false` to disable).

---

## 15 — Editor + provenance affordances

### Open control

```
[ Open ] [ ▾ ]
```

- Primary: **Open** — the **embedded** native editor (Sheet/Docs/PDF/Markdown) inside the SPA. Not a launcher to another tab.
- Dropdown: **Open read-only** (`Cmd-Enter`) · **View history** (`H`) · separator · **Open in external app (WOPI)** — optional interop, shown only when a WOPI target is configured. WOPI is never the default.

### Version badge (in list + editor chrome)

- `vN` badge; tooltip **"v4 · saved 2h ago · verified chain"**. Click → history panel (§9).

### Provenance badge

- `shield-check` **"Verified"** when a document version is Ed25519-signed. Hover: **"Issued by *Registry Office* · 3 Jul 2026 · v5"**. Click → verify + download provenance bundle.

### Encryption

- Encryption is ambient, not per-document toggled: the sidebar **Encrypted** chip states the whole hub is encrypted at rest. Individual rows never show a "make encrypted" control — everything is, always. A `lock` glyph on a row means **legal hold**, not per-file encryption.

---

## Component → token cheat sheet

| Component | Surface tokens | Notes |
|---|---|---|
| Top bar | `--bg-default`, `--border-default` | sticky, 48 px |
| Sidebar | `--bg-canvas` | projects + system |
| Row | hover `--bg-hover`, sel `--bg-selected`, focus `--focus-ring` | 32 px |
| Version badge | `--bg-subtle`, `--fg-muted`, `--font-mono` | head `vN` |
| Verified badge | `--success`, `shield-check` | Ed25519 provenance |
| Hold lock | `--warning`, `lock` | legal hold |
| Button (primary) | `--accent` bg, `--fg-onAccent`, `--radius-md` | |
| Button (danger) | `--danger` bg | release-hold confirm only |
| Toast | `--bg-elevated`, `--shadow-md`, `--radius-lg` | 360 px |
| Modal | `--bg-elevated`, `--shadow-xl`, `--radius-xl` | spring open |
| Chord chip | `--bg-subtle`, `--fg-muted`, `--font-mono`, `--radius-xs` | inline tag |

## States checklist (per surface)

Each surface must specify all of these or explicitly waive them:

- [ ] Default
- [ ] Hover
- [ ] Focus-visible (keyboard)
- [ ] Active / pressed
- [ ] Selected (where applicable)
- [ ] Loading (skeleton or progress)
- [ ] Empty (where applicable)
- [ ] Error
- [ ] Ingest-rejected (upload surfaces)
- [ ] Legal hold (document surfaces)
- [ ] Provenance-verified (document surfaces)
- [ ] Chain-broken / tamper (version surfaces)

The flows in `01-flows.md` × the above states form the test matrix Doc-Hub's component library must cover before any flow is "done".

## What this doc deliberately doesn't cover (deferred)

- **Mobile / narrow viewport** beyond a noted hook.
- **Retention-policy + registrar admin surfaces** — Phase 4.
- **Settings surface** — see [`03-settings-surface.md`](./03-settings-surface.md).
- **Visual mockups** (Figma / renders) — the next step is implementation against this spec.
- **Any media/gallery/thumbnail UI** — out of scope by product design; the hub is documents-only.
