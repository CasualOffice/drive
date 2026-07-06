# 02 — UI Surface Spec

The visual layer beneath the flows in [`01-flows.md`](./01-flows.md). For each surface: ASCII layout, the components and tokens that build it, every state it can be in, the keyboard model, and the motion. No pixel mockups — that is Figma or the implementation; this is the bridge.

Calibration: everything draws from the tokens, components, icon set, and density targets in [`../design/ui-system.md`](../design/ui-system.md). That document is canonical and **supersedes** `../research/04-polish-principles.md`; where they conflict, ui-system wins. When a spacing/radius/colour value appears here, it cites the ui-system token (`--space-3`, `--radius-md`, `--bg-surface`, `--status-verified`). Components reference Radix Primitives, shadcn/ui patterns, cmdk, vaul, sonner, and Lucide. ASCII follows the ui-system convention: layout on the left, the px/token annotation on the right.

Doc-Hub is a records tool — an encrypted, tamper-evident document **registry**, not a Finder/Drive. Density is the feature: 32 px rows, hairline rules, no marketing whitespace. Monochrome-first; amber (`--accent`) is the only chroma and never carries meaning alone (always icon + label). The surface is **projects → documents**, each document carrying a **version chain** and **encryption / lock / verify / hold** state as first-class columns. There are **no thumbnails, no media UI, no gallery** — a `file-text` glyph, a type label, a version, and the status cluster.

Cross-cutting:
- All dimensions snap to the 4 px grid (`--space-*`); nothing in-app exceeds `--space-8` (32 px).
- Concentric corners: a panel at `--radius-lg` (10 px) with `--space-4` (16 px) padding nests inputs at `--radius-sm` (6 px); `inner = outer − padding`.
- Separators are hairlines (`--border-hair`); the default table has zero shadow.
- Focus uses `:focus-visible` only, rendering `--shadow-focus` (2 px amber ring).
- Every surface has a dark-mode variant (ui-system §2.6) and honours `prefers-reduced-motion` (≤50 ms opacity-only).
- Every amber / verified / danger signal pairs a Lucide glyph with a text label (ui-system §2.7).

## Contents

1. App shell (dense: sidebar + compact header + content region)
2. Sidebar (projects + system + encryption chip)
3. Header bar + command-K trigger
4. Toolbar (breadcrumb + actions) + table header
5. Document table (version / lock / verify / hold columns)
6. Empty states
7. Selection bar
8. Command palette (content search + commands)
9. Version-history panel
10. Modals
11. Toasts
12. Drop zones + inline ingest row
13. Sign-in card
14. Recipient share page
15. Editor + provenance affordances

---

## 1 — App shell

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [◧] Doc-Hub    🔍 Search inside documents…   ⌘K       🔒  ⌄ schnsrw      │  top bar   48px
├──────────┬─────────────────────────────────────────────────────────────── ┤
│ SIDEBAR  │ Compliance ▸ Contracts ▸ 2026            [+ New]  [↑ Upload]    │  toolbar   36px
│ 240px    │ ┌───────────────────────────────────────────────────────────┐ │
│ Personal │ │ ▢  Name              Ver  Status         Modified   Size   │ │  header    36px
│  locker  │ ├───────────────────────────────────────────────────────────┤ │
│ ─────────│ │ ▢ 📄 Master-Agr.docx v12  🔒 ✓ intact    2h ago    1.4 MB │ │  row       32px
│ PROJECTS │ │ ▢ 📄 NDA.pdf         v2   🔒 ⚖ hold      1d ago    310 KB │ │
│ ● Legal  │ │ ▢ 📄 Vendors.xlsx    v7   🔒 ✓ intact    last wk   88 KB  │ │
│ ● Finance│ │ …                                                         │ │
│ ─────────│ └───────────────────────────────────────────────────────────┘ │
│ SYSTEM   │                                                                │
│ Activity │                                                                │
│ Trash (3)│                                                                │
│ ─────────│                                                                │
│ 🔒 Encrypted at rest · AES-256-GCM         ← always-on chip (sidebar foot) │
└──────────┴─────────────────────────────────────────────────────────────── ┘
```

**Layout.** Fixed sidebar + fixed top bar + a single scrolling content region. No right panel at rest — the version-history panel (§9) docks in over the right edge (360 px) when invoked.

| Surface | Value | Token / note |
|---|---|---|
| Top bar height | 48 px | `--bg-surface`, hairline bottom, `--shadow-sm` only when content scrolls under |
| Sidebar width | 240 px expanded / 56 px icon-rail | `--bg-canvas`, hairline right border |
| Sidebar item height | 28 px | `--radius-sm` |
| Toolbar height | 36 px | breadcrumb + primary/secondary actions |
| Table header height | 36 px | sticky |
| Row height | 32 px default / 28 px compact / 40 px max | `--space-3` cell pad-x, 6 px pad-y |
| Content padding | `--space-6` (24 px) max on wide; `--space-4` (16 px) default | |

Explicitly rejected (ui-system §4.2): rows ≥48 px, section padding ≥32 px, hero whitespace, airy two-column forms. The shell packs ~18 rows in a 640 px viewport.

**Responsive.** ≥1024 px as above; 720–1023 px sidebar starts as the 56 px icon-rail; <720 px sidebar becomes a vaul drawer and the table compacts to stacked rows (design hook only — mobile is deferred).

**Motion.** Sidebar collapse `--dur-base` (180 ms) `--ease-out`; theme flip colour interpolation ≤`--dur-slow` (260 ms). Nothing in-app exceeds 260 ms.

---

## 2 — Sidebar (projects + system + encryption chip)

```
┌────────────────┐
│ [◧] Doc-Hub    │  brand row → root
├────────────────┤
│ Personal       │  personal locker — unremovable, lock glyph
│  locker    🔒  │
│ ─────────────  │
│ PROJECTS       │  section label (--text-2xs, +0.04em, --fg-subtle)
│ ● Legal        │  role dot + name
│ ● Finance      │  active: --bg-selected + 2px amber left rule + bold
│ ─────────────  │
│ SYSTEM         │
│ 🕒 Activity    │
│ 🗑 Trash   (3) │  tombstone count
│ ─────────────  │
│ 🔒 Encrypted   │  encryption status chip — pinned, always visible
│    at rest     │
└────────────────┘
```

**Sections (top to bottom).**

1. **Brand row.** The `[◧]` app mark (logo, `--radius-app` reserved for the icon only) + "Doc-Hub" wordmark (Inter). Click → root.
2. **Personal locker.** Always present, never deletable, `lock` glyph. First item so the user's private space is anchored.
3. **Projects.** Section label **"PROJECTS"** (`--text-2xs`, `+0.04em` tracking, `--fg-subtle`). One row per team project, each with a role dot (`●`, colour-neutral fill, tooltip names the role). Disclosure chevron expands top-level folders.
4. **System.** Label **"SYSTEM"**. Items: **Activity** (`history`), **Trash** (`archive` + `(N)` tombstone badge). Settings lives in the account menu, not the rail.
5. **Encryption status chip (pinned footer, always visible).** `lock` glyph + **"Encrypted at rest · AES-256-GCM"** in `--fg-subtle`, non-interactive. Tooltip: **"Encrypted at rest · AES-256-GCM · per-workspace key."** There is no toggle — encryption is the default state and boot refuses to start without a key. See §5 and ui-system §7.6 / §8.3.

**Row states.**

| State | Visual |
|---|---|
| Default | transparent; `--fg-default` label, `--fg-subtle` glyph |
| Hover | `--bg-hover` |
| Active | `--bg-selected` + 2 px `--accent` left rule + `--accent` glyph + semibold label |
| Focus-visible | `--shadow-focus` ring |
| Drop-target (upload into project/folder) | `--accent-wash` fill + dashed 1 px `--accent` |

**Icon rail (56 px).** Glyphs only, tooltips at `--dur-base`. The encryption chip collapses to the `lock` glyph (tooltip carries the full label). Toggle `⌘\`.

**Keyboard.** `⌘\` collapse; `⌘1`–`⌘9` jump to projects/system items; roving tabindex within the rail.

---

## 3 — Header bar + command-K trigger

```
┌────────────────────────────────────────────────────────────────────────┐
│ [◧] Doc-Hub    ┌ 🔍 Search inside documents…            ⌘K ┐   🔒  ⌄ A  │
└────────────────────────────────────────────────────────────────────────┘
     brand           centred command-K trigger (content search)     key  acct
```

**Layout.** 48 px, sticky, `--bg-surface`.

- **Left:** app mark (links home).
- **Centre:** the command-K trigger — a faux-input that opens the palette (§8). `search` glyph lead, placeholder **"Search inside documents…"**, `⌘K` kbd chip trailing (`--bg-sunken`, `--mono-xs`, `--radius-xs` — documentation, not a button). Searches **content** (Tantivy full-text), not just names.
- **Right:** key-status glyph (`lock` / `key`, ambient `--fg-subtle`, tooltip surfaces KEK/DEK rotation state — never key material) and the account menu (`⌄` + monogram → Account, Settings, separator, Sign out `⇧⌘Q`).

**Trigger states.** Default `--bg-sunken` + `--border-strong`; hover `--bg-hover`; focus/open `--bg-raised` + `--border-focus` + `--shadow-focus`.

---

## 4 — Toolbar (breadcrumb + actions) + table header

```
Compliance ▸ Contracts ▸ 2026                        [+ New]   [↑ Upload]     ← toolbar 36px
──────────────────────────────────────────────────────────────────────────
▢   Name ▲                 Ver    Status           Modified        Size       ← header 36px
```

**Toolbar (36 px).** `--bg-surface`, hairline below. Left: breadcrumb — first segment is the **project**, the rest folders; current segment `--fg-default`, prior `--fg-muted`, `▸` separators, middle truncation via a `…` popover. Right: **one primary** action (`[+ New]`, `--accent`) and **one secondary** (`[↑ Upload]`, `--bg-raised` + `--border-strong`) per ui-system §1.5.

**Table header (36 px, sticky).** Column labels in `--text-sm` `--fg-muted`. Columns and widths mirror the row (§5): `[checkbox 24] · Name (flex) · Ver 56 · Status ~140 · Modified 96 · Size 72`. Active sort shows ▲/▼ on the clicked label. Size and Version are right-aligned, tabular. No thumbnail/preview column, list view only (a registry, not a media browser).

---

## 5 — Document table (version / lock / verify / hold columns)

The signature surface. One row per document; the status cluster and version column are load-bearing compliance UI (ui-system §7.2), never decorative.

```
┌──┬─────────────────────────┬──────┬─────────────────┬──────────┬────────┐
│▢ │ 📄  Master-Agr.docx     │ v12  │ 🔒 ✓ intact     │ 2h ago   │ 1.4 MB │
└──┴─────────────────────────┴──────┴─────────────────┴──────────┴────────┘
 ↑    ↑   ↑                     ↑      ↑                  ↑          ↑
 sel  ic  name 13px/500         ver    status cluster     modified   size
      16  --fg-default          mono   icon+label chips   sm/muted   mono tnum
```

**Columns.** `[checkbox 24] [file-text 16] [name flex] [version 56 mono] [status ~140] [modified 96] [size 72 mono]`. Row 32 px, cell pad-x `--space-3` (12 px), icon↔text gutter `--space-2` (8 px).

- **Name.** `--text-base` (13 px) `500`, `--fg-default`, truncates. Extension shown muted, non-editable. Type glyph from the documents-only Lucide set (`file-text`, spreadsheet, presentation, pdf, markdown, csv, json, yaml, `folder`) — **no** image/video/audio/archive glyphs; those types never enter the hub.
- **Version.** `vN` head in `--mono-xs`, tabular, `--fg-muted`. Click → version-history panel (§9). Tooltip: **"v12 · saved 2h ago · chain verified"**.
- **Status cluster (load-bearing).** Compact icon+label chips, left→right, each icon always paired with a label or labelled tooltip:
  - `lock` — **encrypted at rest**, ambient `--fg-subtle`. Present on every row; encryption is the default, so it reads calm.
  - `shield-check` **"intact"** (`--status-verified`, muted forest) **or** `shield-alert` **"tamper"** (`--status-danger`, brick) — chain verification outcome.
  - `gavel` **"hold"** (`--status-attention`, amber) — legal hold; only when held.
  - `badge-check` **"signed"** (`--status-verified`) — when the head version is Ed25519-signed.
- **Modified.** Relative time, `--text-sm` (12 px) `--fg-muted` (≈8.6:1 on paper, AA), tabular; full timestamp on hover.
- **Size.** `--mono-xs`, tabular, right-aligned, `--fg-muted`.

**Row states.**

| State | Visual |
|---|---|
| Default | `--bg-surface`, hairline bottom (`--border-hair`) |
| Hover | `--bg-hover`; right-aligned row actions (`download`, `share-2`, `history`, `⋯`) fade in at `--dur-instant`; the AI **[Ask]** chip appears when `dochub-ai` is on |
| Focus-visible | `--shadow-focus` inset ring; full row focusable, arrow-key navigable |
| Selected | `--bg-selected` + 2 px `--accent` left rule + checked box; raises the selection bar (§7) |
| On legal hold | `gavel` **"hold"** chip (`--status-attention`); actions that violate the hold are **removed** from the row menu, not greyed |
| Verified | `shield-check` **"intact"** chip (`--status-verified`), quiet |
| Tamper (chain broken) | `shield-alert` **"tamper"** chip (`--status-danger`); row carries a subtle `rgba(163,44,34,0.08)` tint and links to the version panel banner; `role="alert"` |
| Ingesting / uploading | ghost row 60 % opacity, 2 px determinate progress bar (`--accent`), `upload-cloud` overlay; rejected → danger tint + tooltip |
| Indexing | muted **"(indexing)"** after the name until `index_state = ready` |
| Editing (co-edit) | avatar stack + `pencil` glyph after the name, live |
| Loading | skeleton row — shimmer bars at name/version/status/date/size widths, `--dur-slow` pulse (static under reduced motion) |

**Inline rename.** Name cell → input matching row typography; extension stays inline muted. Renaming is metadata-only and audited; it does **not** create a version.

**Keyboard.** `↑↓` focus, `Space` select, `⌘A` select all, `Enter` open, `F2` rename, `Backspace`/`Delete` trash (tombstone; blocked with an explaining toast when held), `H` history, `Esc` clear.

**Motion.** FLIP reflow on insert/tombstone (`--dur-base` `--ease-out`); selection toggle `--dur-fast`; progress frame-locked to real events.

**Virtualisation.** `@tanstack/react-virtual` above 100 rows; fixed 32 px height.

---

## 6 — Empty states

Pattern (ui-system §1.12, §6.2): centred column 420 px, vertical flow, the **document-stack** motif (Lucide `layers` / `files`, echoing the logo's three offset sheets) at 24 px in `--fg-subtle`, never animated. Title `--text-lg`, subtitle `--text-sm` `--fg-muted`, one primary CTA. Never a dead end.

```
                    ┌───────────┐
                    │  ▤ ▤ ▤    │   layers / files motif, 24px, --fg-subtle
                    └───────────┘
              This project has no documents yet.        ← --text-lg
        Upload documents, or create one to begin the    ← --text-sm --fg-muted
                     registry.
                    [ ↑ Upload ]                          ← primary, --accent
```

| Surface | Title | Subtitle | CTA |
|---|---|---|---|
| No projects yet | "Create your first project." | "Projects hold your documents — a team space or your personal locker." | New project |
| Empty project | "This project has no documents yet." | "Upload documents, or create one to begin the registry." | Upload |
| Empty folder | "This folder is empty." | "Drop documents to add." | — |
| Search (no results) | "No documents match \"<q>\"." | "Search reads inside documents, not just names." | Clear search |
| Trash (empty) | "Trash is empty." | "Trashed documents are retained under policy, then purged." | — |
| Activity (empty) | "No activity yet." | "Actions in this hub will appear here — append-only, hash-chained." | — |
| Single version (history) | "One version. History begins here." | "New versions append; nothing is ever overwritten." | — |

**Polish.** No tutorial overlay; fade in `--dur-base` after mount (instant under reduced motion).

---

## 7 — Selection bar

```
                        ┌───────────────────────────────────────────────┐
                        │ 3 selected   ↓ Download   🔗 Share   → Move  ⌫ │  44px
                        └───────────────────────────────────────────────┘
```

- Bottom-centred, inset `--space-6` (24 px), 44 px tall, vaul drawer (persistent until cleared), `--bg-raised`, `--radius-xl`, `--shadow-lg`.
- Contents: **"N selected"** → action chips (`download` **Download**, `share-2` **Share…**, **Move…**) → hairline → **Trash** (`--status-danger` text, `archive` glyph) → spacer → **Clear** (`×`).
- Actions that can't apply to a mixed selection are **hidden**, not greyed. Trash respects legal hold: held docs are skipped, noted in the toast — **"Moved 4 · 1 skipped (under hold)"** with `gavel`.
- Motion: slide up `--dur-base` `--ease-out` (fade under reduced motion); `Esc` dismiss.

---

## 8 — Command palette (content search + commands)

```
┌──────────────────────────────────────────────────────────────┐
│ 🔍 Search inside documents…                             Esc  │  input   30px
├──────────────────────────────────────────────────────────────┤
│ [ Type ] [ Project ] [ Date ]                                │  filter chips
│ DOCUMENTS                                                    │
│  📄 Master-Agr.docx   "…termination within 30 days…"        │  content snippet
│                        Compliance ▸ Contracts        v12    │  path + version
│  📄 Vendors.xlsx       "…net-30 payment terms…"       v7    │
│ ──────────────────────────────────────────────────────────  │
│ COMMANDS                                                     │
│  + New project                                       ⌘⇧P    │
│  ↑ Upload documents                                   U     │
│  📤 Export audit report                                     │
│  ✦ AI · read-only  Ask across this project…                │  sparkles, no mutate
└──────────────────────────────────────────────────────────────┘
```

- Centred modal, 560 px, `--bg-raised`, `--shadow-md`, `--radius-lg`, top-aligned. cmdk under the hood.
- **Documents** zone: **content** hits (Tantivy full-text over `core`-extracted text) — highlighted **snippet**, project/folder path, matching version. Filter chips (Type / Project / Date) sit under the input.
- **Commands** zone: actions with kbd chips.
- **AI (read-only).** When `dochub-ai` is on, semantic search + Q&A surface as a suffixed block labelled **"AI · read-only"** (`sparkles`), cited, and **never mutating** state.
- States: **empty** → recent documents + shortcuts; **typing** → skeleton rows; **results** → content matches (≤8) + command matches; **no-results** → **"No documents match \"<q>\"."** with the registry motif; **error** → inline retry.
- Motion: `--dur-base` open, calm, no bounce.

---

## 9 — Version-history panel

Right-docked, 360 px, newest at top (matches the logo stack). Renders the literal hash chain with per-link intact/broken markers (ui-system §7.3).

```
┌ Version history — Master-Agr.docx ──────────────────── [Verify chain] ┐
│                                                                       │
│  ●  v12  current            2h ago · schnsrw                          │
│  │       reason: "signed final"                                      │
│  │       content_hash  9f3a…c1  ⧉               ✓ link intact         │  mono/tnum
│  │                                              [Restore ⤴]           │
│  ┿  ← link (shield-check, --status-verified)                         │
│  ○  v11                     1d ago · aria                            │
│  │       content_hash  71bd…8e  ⧉   prev 9f3a…c1   ✓ link intact      │
│  ┿                                                                    │
│  ○  v10                     3d ago · schnsrw                         │
│  │       content_hash  4c8e…2a  ⧉   prev 71bd…8e                     │
│  ┋                                                                    │
│  ⛓✗ v7 → v6   LINK BROKEN                                [Details]   │  --status-danger
│                                                                       │
├────────────────────────────────────────────────────────────────────  ┤
│ Chain: 12 versions · ✓ 11 verified · ✗ 1 broken       [Export ⧉]     │
└────────────────────────────────────────────────────────────────────  ┘
```

- Slides in over the right edge (`--bg-raised`, `--shadow-lg`, `--radius-lg`) or opens as a Radix Dialog on narrow viewports.
- **Node:** filled `●` = current, hollow `○` = prior (`git-commit-horizontal`); the vertical `│` is the chain. A verified segment shows `┿` / `shield-check` (`--status-verified`); a broken segment shows `⛓✗` / `unlink` (`--status-danger`) with a persistent inline alert.
- **Header — verified:** `shield-check` **"Chain verified · N versions"** (`--status-verified`), quiet.
- **Header — tamper:** a block-level alarm, `shield-alert` (`--status-danger`, subtle fill + 1 px border), `role="alert"` `aria-live="assertive"`: **"Chain verification failed at v7. Deletion is blocked and an admin has been notified."** Cannot be dismissed without resolution; restore disabled until admin ack. Never a silent tint, never auto-repaired.
- **Hashes:** `--mono-xs`, truncated `9f3a…c1`, click-to-copy (`copy` glyph, toast "Hash copied"); full hash in the `aria-label` and hover tooltip.
- **Verify chain:** primary panel action → runs `verify_chain`, streams node-by-node (spinner per node → check/alert), footer summarises `n verified · m broken`.
- **Restore:** `rotate-ccw` **"Restore as new version"** — additive copy; inline confirm **"Restore v10? This adds a new version — nothing is lost."** Appends v13, never mutates.
- **Diff:** select two nodes (or version↔head); text/markdown line diff, `.xlsx` changed-cells, `.docx` tracked prose, `.pdf` page-level — all derived from `core`, read-only.
- **Export provenance:** offline-verifiable bundle (hashes + Ed25519 signature + version-bytes reference), `download`.
- States: loading (skeleton nodes) · default · verified · verifying (per-node spinners → static count-up under reduced motion) · tamper (danger banner) · diff-active · single-version empty (§6).
- Keyboard: `↑↓` move, `Enter` view, `D` diff-select, `R` restore, `Esc` close.

---

## 10 — Modals

Radix Dialog throughout: centred, 440–560 px, `--bg-raised`, `--radius-xl`, `--shadow-lg`, `--space-5` (20 px) padding. Overlay `rgba(22,22,26,0.40)`. Title `--text-lg`, body `--text-base`, footer right-aligned (one secondary + one primary). Focus trapped; `Esc` + outside click dismiss, **except** destructive/consequential confirms. Reduced motion → fade only.

### 10.1 New project

```
┌ New project ─────────────────────────── ✕ ┐
│ Name        [____________________]         │
│ Description [____________________] (opt.)  │
│ A team project — you will be the Owner.    │
│                         [Cancel] [Create]  │
└────────────────────────────────────────────┘
```

### 10.2 Move to… picker

```
┌ Move 3 documents to… ─────────────── Esc ┐
│ 🔍 Search folders                        │
│ ▸ Compliance 2026                        │
│   ▸ Contracts                            │
│     • 2026     ← cursor                  │
│ ▸ Personal locker                        │
│                     [Cancel] [Move here] │
└──────────────────────────────────────────┘
```

Move is within/between projects the user can write to; documents keep their full version chain.

### 10.3 Share modal

See [`05-sharing-surface.md`](./05-sharing-surface.md). Link card (`--accent-wash` bg + `--accent` border), collapsible options (Permission / Expires / Password — Argon2id), existing-links list with a revoke control. States the link lives on the isolated user-content origin. Copy shows an inline check, no toast.

### 10.4 Legal-hold confirm

```
┌ This document is on legal hold. ──────────┐
│ Deletion, tombstoning, and purge are      │
│ blocked until the hold is released.       │
│ Placed by schnsrw · 2026-03-11.           │
│                                 [   OK   ] │
└────────────────────────────────────────────┘
```

`gavel` (`--status-attention`). There is **no** "permanently delete now" modal for documents — purge is governed by retention policy server-side, never a user gesture. The only destructive-looking confirm is **releasing** a legal hold (admin, audited, requires explicit action — no outside-click dismiss).

**Modal cross-cutting.** Focus trap; first interactive element focused on open; focus returns to the trigger on close.

---

## 11 — Toasts

sonner, bottom-right, `--bg-raised`, `--radius-md`, `--shadow-md`, `--text-sm`, max 4 stacked. Verb-first, terse, present tense, no exclamation marks. Icon per status, label always present.

```
┌──────────────────────────────────────────┐
│ ✓ Restored v10 as v13.               Undo │
└──────────────────────────────────────────┘
```

| Variant | Glyph | Colour | Use |
|---|---|---|---|
| Success | `check-circle-2` | `--status-verified` | "Uploaded 3 documents.", "Restored v10 as v13.", "Version 13 saved." |
| Info | `info` | `--status-info` | "Signed out for security." |
| Attention | `gavel` / `clock` | `--status-attention` | "Moved 4 · 1 skipped (under hold)." |
| Error | `shield-alert` | `--status-danger` | "Couldn't upload. Check the file type and retry." (persists until dismissed) |

Lifetime: 4 s default, 8 s with **Undo** (`rotate-ccw`, safe ops only), errors persist. `aria-live="polite"` (errors `assertive`).

---

## 12 — Drop zones + inline ingest row

### Window-wide drop zone

```
╔══════════════════════════════════════════════════════╗
║                 ┌────────────────────┐               ║
║                 │        ↑            │               ║
║                 │  Drop documents    │               ║
║                 │  into Contracts    │               ║
║                 └────────────────────┘               ║
╚══════════════════════════════════════════════════════╝
```

Canvas dims `--dur-fast` (120 ms); dashed 2 px `--accent` card at `--radius-md`, `upload-cloud` glyph, caption names the destination. Non-document types are rejected on drop with a per-batch attention toast (§11) — the card never implies "anything goes". The ingest allowlist (`docx, xlsx, xlsm, pptx, pdf, md, txt, csv, json, yaml`) is enforced by extension **and** magic-byte sniff.

### Inline ingest row

The §5 uploading/ingesting row state — ghost row, determinate progress, resolves to a **v1** document on 201, then shows **"(indexing)"** until searchable.

---

## 13 — Sign-in card

```
              ╭──────────────────────────────╮
              │             [◧]              │
              │           Doc-Hub            │
              │      Sign in to continue.    │
              │   ┌────────────────────┐     │
              │   │ Username           │     │
              │   └────────────────────┘     │
              │   ┌────────────────────┐     │
              │   │ Password         🔒 │     │
              │   └────────────────────┘     │
              │   [        Sign in       ]   │
              │   ──────── or ───────        │
              │   [   Sign in with SSO   ]   │  only if OIDC configured
              ╰──────────────────────────────╯
```

- 360 px, centred, `--radius-xl`, `--shadow-lg`, hairline. App mark 28 px.
- Inputs 30 px (`--bg-sunken`, `--border-strong`, `--radius-sm`). **Sign in with SSO** (OIDC Auth Code + PKCE) shown only when an IdP is configured.
- Caps-lock helper; shake-on-error (8 px, `--dur-slow`, 1 cycle; static under reduced motion). Error **"Wrong username or password."**
- Solid `--bg-canvas` ground, no marketing imagery.

---

## 14 — Recipient share page

```
              ╭──────────────────────────────╮
              │            📄                │  document type glyph, 24px
              │      Q2 planning.xlsx        │
              │      Spreadsheet · 28.4 KB   │
              │      🔒 Shared read-only     │
              │      [  Open read-only   ]   │
              │      [  Download         ]   │
              ╰──────────────────────────────╯
                     Powered by Doc-Hub
```

- Stripped of hub chrome, cookieless, minimal. 440 px card. Document formats only — no media preview. Bytes come from the user-content origin (`CSP: sandbox; default-src 'none'`).
- `lock` badge (`--fg-subtle`) states the share is read-only. Password-gate variant: `lock` glyph, single input, **Continue**.
- Expired / revoked / not-found all show **"This link is no longer active."** (anti-enumeration — one message, constant-time compare).
- Footer **"Powered by Doc-Hub"**, operator opt-in (`DOCHUB_RECIPIENT_FOOTER=false` to disable).

---

## 15 — Editor + provenance affordances

### Open control

```
[ Open ] [ ⌄ ]
```

- Primary: **Open** — the **embedded** native editor (Sheet/Docs/PDF/Markdown) inside the SPA. Not a launcher to another tab.
- Dropdown: **Open read-only** (`⌘⏎`) · **View history** (`H`) · separator · **Open in external app (WOPI)** — optional interop, shown only when a WOPI target is configured. WOPI is never the default.

### Version badge (list + editor chrome)

`vN` in `--mono-xs`; tooltip **"v12 · saved 2h ago · chain verified"**. Click → history panel (§9).

### Provenance card

`badge-check` **"Signed"** + `shield-check` **"Verified"** when the head version is Ed25519-signed (ui-system §7.8). Fields mono where cryptographic (issuer fingerprint, `content_hash`), tabular timestamps. Verify runs the Ed25519 check → intact/tamper badge; **Export offline-verifiable bundle** downloads the chain. Unsigned is neutral **"Not signed"** + a role-gated **"Sign this version"** — not alarming.

### Encryption (ambient)

Encryption is ambient, never per-document toggled: the sidebar footer chip (§2) states the whole hub is encrypted at rest, and each row carries the quiet `lock` chip. Rows never show a "make encrypted" control — everything is, always. A `gavel` chip on a row means **legal hold**, not per-file encryption.

---

## Component → token cheat sheet

| Component | Surface tokens | Notes |
|---|---|---|
| Top bar | `--bg-surface`, `--border-hair` | sticky, 48 px |
| Sidebar | `--bg-canvas`, `--border-hair` | 240 px / 56 px rail |
| Sidebar item | hover `--bg-hover`, active `--bg-selected` + 2 px `--accent` rule | 28 px, `--radius-sm` |
| Encryption chip | `lock`, `--fg-subtle` | pinned footer, non-interactive |
| Row | `--bg-surface`, hover `--bg-hover`, sel `--bg-selected`, focus `--shadow-focus` | 32 px |
| Version | `--mono-xs`, `--fg-muted` | head `vN`, click → §9 |
| Verified chip | `shield-check`, `--status-verified` | "intact" |
| Tamper chip | `shield-alert`, `--status-danger` | "tamper", `role="alert"` |
| Hold chip | `gavel`, `--status-attention` | "hold" |
| Signed chip | `badge-check`, `--status-verified` | Ed25519 provenance |
| Button (primary) | `--accent` bg, `--accent-fg`, `--radius-sm` | 28 px; one per surface |
| Button (secondary) | `--bg-raised`, `--border-strong` | |
| Button (danger) | transparent, `--status-danger` text + border | release-hold confirm only |
| Input | `--bg-sunken`, `--border-strong`, `--radius-sm` | 30 px |
| Toast | `--bg-raised`, `--shadow-md`, `--radius-md` | bottom-right |
| Modal | `--bg-raised`, `--shadow-lg`, `--radius-xl` | fade/scale open |
| Kbd chip | `--bg-sunken`, `--fg-muted`, `--mono-xs`, `--radius-xs` | inline tag |
| Empty-state motif | `layers` / `files`, `--fg-subtle` | registry stack, 24 px |

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
- [ ] Reduced-motion

The flows in `01-flows.md` × the above states form the test matrix Doc-Hub's component library must cover before any flow is "done".

## What this doc deliberately doesn't cover (deferred)

- **Mobile / narrow viewport** beyond the noted hook.
- **Retention-policy + registrar admin surfaces** — Phase 4.
- **Settings surface** — see [`03-settings-surface.md`](./03-settings-surface.md).
- **Audit-trail surface detail** — the row anatomy is specified in ui-system §7.4; the full surface lands with the compliance phase.
- **Visual mockups** (Figma / renders) — the next step is implementation against this spec and `../design/ui-system.md`.
- **Any media/gallery/thumbnail UI** — out of scope by product design; the hub is documents-only.
