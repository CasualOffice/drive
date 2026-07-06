# Doc-Hub — UI design system

Canonical, implementable UI system for the Doc-Hub SPA. Derived from `logo.svg`; grounded in `README.md`, `VISION.md`, `docs/ARCHITECTURE.md`. **This supersedes `docs/research/04-polish-principles.md` (the old 10 commandments + v1/v2 polish tokens).** Where they conflict, this document wins.

Doc-Hub is a records tool — an encrypted, tamper-evident document *registry*, not a Drive. The UI is dense, precise, and compliance-forward. Trust is shown, not stated: version chains, hash verification, encryption, holds, and provenance are first-class UI, never buried in settings.

---

## 1. Principles (supersede the 10 commandments)

1. **Density is the feature.** This is a records tool. Compact rows, tight rhythm, no marketing whitespace. Default table row is **32px**; the maximum is **40px**. Reject generous spacing.
2. **Monochrome first; amber is the only chroma.** The ink→paper gray ramp carries the entire UI. Amber (`#B7791F`) appears only for status and attention. If a screen has more than a few amber pixels at rest, it is wrong.
3. **Amber never means anything alone.** Every amber signal pairs with an icon and a text label. Color is never the sole carrier of meaning (WCAG 1.4.1).
4. **Type carries hierarchy.** Weight, size, and the gray ramp establish rank before any box, divider, rule, or fill.
5. **One primary action per surface.** One primary button. One secondary. Everything else is a tertiary/ghost control or an icon.
6. **Snap to the 4px grid. Concentric corners.** Every dimension is a multiple of 4. `inner_radius = outer_radius − padding`, always.
7. **Sub-100ms or it is broken.** Optimistic UI for every plausibly-safe write. Skeletons for content, spinners only for short finite system tasks.
8. **Compliance surfaces are load-bearing, not decorative.** Version chain, audit trail, verification badge, encryption badge, hold/retention banner, provenance card get first-class component treatment and every state designed.
9. **Tamper is an alarm, not a color swap.** A broken hash chain or failed verification is a persistent, dismissible-only-by-resolution alert with icon + label + remediation — never a silent red tint.
10. **Immutable actions read as additive.** "Restore", "delete", and "new version" never imply erasure. Copy and iconography reinforce append-only reality.
11. **Keyboard is a first-class surface.** Command-K everywhere; every important action has an advertised shortcut.
12. **Every surface has an empty state** using the registry motif (stack of versioned sheets). Never a dead end.
13. **`prefers-reduced-motion` is honored everywhere.** No exceptions.
14. **One icon family, one stroke.** Lucide, 1.5px stroke, 24×24 grid. Same glyph for the same concept app-wide.
15. **Copy is terse, present tense, sentence case.** Errors state *what* and *what next*. Never "Oops".

---

## 2. Color

### 2.1 Source (logo-exact)

Five hexes taken directly from `logo.svg`. These are the roots of every token. No new chroma is introduced.

| Role in logo | Hex | Use |
|---|---|---|
| Ink / container | `#16161A` | primary text, dark surfaces, document body glyphs |
| Older layer (v2) | `#45454B` | secondary text, strong borders |
| Older layer (v3) | `#8A8A92` | tertiary text, muted UI, disabled |
| Current version / paper | `#F5F3EE` | canvas, the current-version sheet |
| Amber accent | `#B7791F` | status/attention only — the sole chroma |

### 2.2 Neutral ramp (ink → paper)

Warm-neutral ramp interpolated between logo ink and paper. All UI neutrals resolve to these.

```
--ink-950: #16161A   /* logo ink — near-black */
--ink-900: #1E1E23
--ink-800: #2A2A30
--ink-700: #35353C
--ink-600: #45454B   /* logo gray 2 */
--ink-500: #5C5C63
--ink-400: #767680
--ink-300: #8A8A92   /* logo gray 3 */
--ink-200: #ADADB4
--ink-150: #C9C7C2
--ink-100: #DEDCD5
--paper-100: #EAE8E1
--paper-200: #F0EEE7
--paper-300: #F5F3EE   /* logo paper */
--paper-400: #FBFAF6   /* lifted paper (cards) */
--white:     #FFFFFF
```

### 2.3 Amber ramp (sole chroma)

Single hue. Used for status/attention/interactive-emphasis only.

```
--amber-700: #8F5F17   /* pressed / text-on-paper for AA */
--amber-600: #B7791F   /* logo amber — DEFAULT accent */
--amber-500: #C88A2A   /* hover on dark */
--amber-100: #F3E7D0   /* subtle fill (light) */
--amber-tint: rgba(183,121,31,0.10)  /* selection / attention wash */
```

### 2.4 Default theme decision — **light (paper) is default**

The logo is a **dark mark on warm paper** — its ground is paper, its figure is ink. The product default mirrors the logo's ground: a warm-paper canvas with ink type. This reads as a document/records surface (paper), maximizes legibility for dense text tables, and matches the archival, "authoritative record" feel. Dark theme is a first-class peer, not an afterthought, but paper is canonical. Theme is user-selectable and respects `prefers-color-scheme`.

### 2.5 Semantic tokens — light (default)

```
/* surfaces */
--bg-canvas:     #F5F3EE   /* paper-300, page ground (matches logo) */
--bg-surface:    #FBFAF6   /* paper-400, cards/tables/panels */
--bg-raised:     #FFFFFF   /* popovers, dialogs, menus */
--bg-sunken:     #F0EEE7   /* wells, code/hash blocks, inputs */
--bg-hover:      rgba(22,22,26,0.04)
--bg-active:     rgba(22,22,26,0.07)
--bg-selected:   rgba(183,121,31,0.10)   /* amber tint — pairs with a left rule + icon */

/* text */
--fg-default:    #16161A   /* ink-950 */
--fg-muted:      #45454B   /* ink-600 — secondary */
--fg-subtle:     #8A8A92   /* ink-300 — metadata, timestamps */
--fg-disabled:   #ADADB4   /* ink-200 */
--fg-on-accent:  #FFFFFF
--fg-on-ink:     #F5F3EE   /* text on dark surfaces */

/* borders — hairline first */
--border-hair:   rgba(22,22,26,0.08)   /* default 1px separators, table rules */
--border-strong: rgba(22,22,26,0.16)   /* inputs, emphasized dividers */
--border-focus:  #B7791F

/* accent */
--accent:        #B7791F   /* amber-600 */
--accent-hover:  #A56D1B
--accent-press:  #8F5F17
--accent-fg:     #FFFFFF
--accent-wash:   rgba(183,121,31,0.10)

/* status — minimal chroma; each ALWAYS pairs with icon + label.
   Base values are for FILLS / ICONS / BORDERS (≥3:1 non-text) only. */
--status-verified: #2F6B4F   /* muted forest — chain intact / verified */
--status-attention:#B7791F   /* amber — hold, retention due, pending */
--status-danger:   #A32C22   /* muted brick — tamper, integrity break, error */
--status-info:     #45454B   /* neutral ink — informational, no hue */

/* status TEXT steps — AA (≥4.5:1) on paper #F5F3EE. Use these whenever a
   status hue is applied to TEXT; the base values above are non-text only. */
--status-verified-700: #2F6B4F   /* ≈5.7:1 — base already passes for text */
--status-attention-700:#8F5F17   /* amber-700 — ≈4.96:1 (base #B7791F is 3.28:1, non-text only) */
--status-danger-700:   #A32C22   /* ≈6.4:1 — base already passes for text */
--status-info-700:     #45454B   /* ≈8.6:1 — base already passes for text */
```

Status hues are **desaturated on purpose** — this is monochrome-first. Verified green and danger brick are the only two non-amber chromas, reserved strictly for integrity outcomes (intact vs. tamper) where a second axis is genuinely needed. They always carry an icon and label.

### 2.6 Semantic tokens — dark

Warm dark, never pure black (the logo ink `#16161A` is the darkest surface, not `#000`).

```
--bg-canvas:     #131316
--bg-surface:    #16161A   /* logo ink as ground */
--bg-raised:     #1E1E23
--bg-sunken:     #101013
--bg-hover:      rgba(245,243,238,0.05)
--bg-active:     rgba(245,243,238,0.08)
--bg-selected:   rgba(200,138,42,0.14)

--fg-default:    #F0EEE7
--fg-muted:      #ADADB4
--fg-subtle:     #8A8A92
--fg-disabled:   #5C5C63
--fg-on-accent:  #16161A

--border-hair:   rgba(245,243,238,0.10)
--border-strong: rgba(245,243,238,0.18)
--border-focus:  #C88A2A

--accent:        #C88A2A   /* amber-500 — lifted for contrast on dark */
--accent-hover:  #D69A3E
--accent-press:  #B7791F
--accent-fg:     #16161A
--accent-wash:   rgba(200,138,42,0.14)

--status-verified: #5FA07E
--status-attention:#C88A2A
--status-danger:   #D6685C
--status-info:     #ADADB4
```

### 2.7 Rule: amber never encodes meaning alone

Every use of `--accent` / `--status-attention` is accompanied by (a) a Lucide icon from the security set and (b) a text label. A held document shows the lock glyph **and** the word "Hold". A tamper alarm shows the broken-chain glyph **and** "Tamper detected". Disabling color must never remove information. Verified/danger likewise always carry icon + label.

---

## 3. Typography

### 3.1 Families (match the logo)

The logo wordmark is **Inter**. The UI follows the logo — no serif display face.

```
--font-ui:   'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
--font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;
```

- **Inter** — all UI text, labels, headings, body. Self-hosted variable font. `letter-spacing` tracks the logo: normal for body; `+0.04em` for the small all-caps section labels that echo the wordmark's `letter-spacing:4`.
- **JetBrains Mono** — the "proof" typeface: all content hashes, `content_hash`/`prev_hash`, version numbers (`v12`), ULIDs, `jti`, signatures, key fingerprints, audit event codes, byte sizes in dense inspectors. Anything the user might compare character-by-character is mono.

### 3.2 Compact scale (px / line-height / weight)

Small-but-legible. Body UI is **13px**. Nothing on a dense surface exceeds 20px except the one page title.

| Token | Size | Line-height | Weight | Use |
|---|---|---|---|---|
| `--text-2xs` | 10px | 12px | 600 | badge/chip caps, version tag |
| `--text-xs` | 11px | 14px | 500 | metadata, timestamps, column subtext |
| `--text-sm` | 12px | 16px | 500 | secondary labels, table meta, tooltips |
| `--text-base` | 13px | 18px | 450 | **default body / row text** |
| `--text-md` | 14px | 20px | 500 | emphasized rows, input text, buttons |
| `--text-lg` | 16px | 22px | 600 | panel titles, section heads |
| `--text-xl` | 20px | 26px | 600 | page title (one per surface) |
| `--mono-xs` | 11px | 15px | 500 | inline hashes, IDs |
| `--mono-sm` | 12px | 16px | 500 | hash blocks, audit codes |

Weights available: 450 (body), 500 (default label), 600 (semibold heads/badges). No 700+; no italics except a single localized "no results" empty-state line.

### 3.3 Numerals & tabular data

`font-variant-numeric: tabular-nums` is **mandatory** for every: file size, date/time, version number, `seq`, byte count, hash, ID, retention countdown, member count. Applied globally via a `.tnum` utility and baked into mono. Hashes render mono + tabular so columns align and characters compare cleanly.

---

## 4. Space & grid

### 4.1 Scale (4px base, tight)

```
--space-0:  0
--space-1:  4px    /* icon↔label gap, chip padding-y */
--space-2:  8px    /* control padding, tight row gutter */
--space-3:  12px   /* row padding-x, cell gutter */
--space-4:  16px   /* panel padding, section gap */
--space-5:  20px
--space-6:  24px   /* max container padding */
--space-8:  32px   /* page margins on wide, empty-state stack */
```

No values above 32px in-app. `--space-8` is the ceiling; anything larger is a layout smell on a records tool.

### 4.2 Density targets (concrete, enforced)

| Surface | Value |
|---|---|
| Table row height | **32px** default, **28px** compact mode, **40px** absolute max |
| Table cell padding-x | 12px (`--space-3`) |
| Table cell padding-y | 6px |
| Row inner gutter (icon↔text) | 8px (`--space-2`) |
| Header row height | 36px |
| Sidebar item height | 28px |
| Sidebar width | 240px (collapsible to 56px icon-rail) |
| Top bar height | 48px |
| Toolbar / selection bar height | 44px |
| Button height (default) | 28px; (small) 24px; (large) 32px |
| Input height | 30px |
| Panel/drawer padding | 16px (`--space-4`) |
| Dialog padding | 20px (`--space-5`) |
| Section vertical gap | 16px; between major blocks 24px |
| Column gutter (grid) | 16px |

**Explicitly rejected:** row heights ≥48px, section padding ≥32px, hero whitespace, 2-column airy forms. Doc-Hub packs ~18 table rows in a 640px viewport.

### 4.3 Layout

12-column fluid grid, 16px gutter, content max-width 1440px, table area fluid. App shell is a fixed sidebar + fixed top bar + scrolling content region. Panels (version history, activity) dock right at 360px.

---

## 5. Radii, elevation, borders, motion

### 5.1 Radii — concentric, from the logo rounded square

The logo container is `rx=40` on a 172px square (0.23 ratio); inner document sheets are `rx=10`; text pills `rx=3`. The scale echoes this concentric nesting: `inner = outer − padding`.

```
--radius-2xs: 3px    /* pills/tags inside chips (echoes logo rx=3) */
--radius-xs:  4px    /* chips, badges, inline code */
--radius-sm:  6px    /* buttons, inputs, menu items */
--radius-md:  8px    /* rows, small cards */
--radius-lg:  10px   /* panels, popovers, cards (echoes logo sheet rx=10) */
--radius-xl:  14px   /* dialogs, drawers */
--radius-2xl: 20px   /* app-identity tiles, large sheets */
--radius-app: 40px   /* the logo container; app icon / splash mark only */
```

Concentric rule worked example: a card at `--radius-lg` (10px) with 16px padding nests an input at `--radius-sm` (6px) — visually parallel corners. A dialog at `--radius-xl` (14px) with a 20px gutter nests panels at `--radius-md` (8px).

### 5.2 Elevation — hairline first, minimal shadow

Separation is by hairline border and surface tint before shadow. Shadows are shallow and warm (ink-based, never pure black).

```
--shadow-none: none;                                   /* tables, rows, sidebar — borders only */
--shadow-sm:   0 1px 2px rgba(22,22,26,0.06);          /* raised chips, sticky headers */
--shadow-md:   0 4px 12px rgba(22,22,26,0.08);         /* popovers, menus, command-K */
--shadow-lg:   0 12px 32px rgba(22,22,26,0.12);        /* dialogs, right drawers */
--shadow-focus: 0 0 0 2px var(--bg-surface), 0 0 0 4px rgba(183,121,31,0.55);
```

Rule: never use `--shadow-lg` where a hairline + `--bg-raised` reads clearly. The default table has **zero shadow**.

### 5.3 Borders

`1px solid var(--border-hair)` is the default separator for rows, tables, sidebar sections, and cards. `--border-strong` for inputs and emphasized rules. Never double-border adjacent elements; collapse to a single shared hairline.

### 5.4 Motion

```
--ease-out:   cubic-bezier(0.2, 0.8, 0.2, 1);   /* default */
--ease-in:    cubic-bezier(0.4, 0, 1, 1);
--ease-inout: cubic-bezier(0.65, 0, 0.35, 1);

--dur-instant: 80ms    /* hover/focus/press flips */
--dur-fast:    120ms   /* toggles, checkbox, chip */
--dur-base:    180ms   /* panel/drawer open, menu */
--dur-slow:    260ms   /* route/full-panel swap */
```

No motion over 260ms in-app. Verification/tamper alerts appear at `--dur-base` with no bounce — trust surfaces do not spring.

**Reduced motion:** under `prefers-reduced-motion: reduce`, all transitions collapse to ≤50ms opacity-only; no transforms, no slide, no spring. Toast/panel entrances become instant fades.

---

## 6. Iconography

### 6.1 System

One family: **Lucide**, 1.5px stroke, 24×24 grid, `currentColor`. Render at 16px in rows/buttons, 14px in chips, 20px in panel heads, 24px in empty states. Never mix a second icon set. Never re-color an icon to carry meaning without an adjacent label.

### 6.2 Registry & security motif set (canonical glyph → concept)

| Concept | Lucide glyph | Meaning | Default color |
|---|---|---|---|
| Document (registry unit) | `file-text` | a hub document | `--fg-muted` |
| Document stack / registry | `layers` / `files` | version stack, project of docs, empty-state motif | `--fg-muted` |
| Version / chain link | `link` (intact), `unlink` (broken) | hash-chain link between versions | intact `--fg-subtle`, broken `--status-danger` |
| Version node | `git-commit-horizontal` | a version in the timeline | `--fg-muted` |
| Encrypted / at rest | `lock` | AES-256-GCM at rest | `--fg-subtle` (ambient) |
| Verified / integrity intact | `shield-check` | chain verified, hashes match | `--status-verified` |
| Tamper / integrity break | `shield-alert` / `shield-x` | verification failed | `--status-danger` |
| Provenance / signature | `badge-check` / `stamp` | Ed25519-signed, issuer known | `--status-verified` |
| Legal hold | `gavel` | document under legal hold | `--status-attention` |
| Retention | `clock` / `hourglass` | retention timer / due | `--status-attention` |
| Key status | `key` / `key-round` | KEK/DEK/key rotation state | `--fg-subtle` |
| Audit event | `scroll-text` / `history` | append-only log entry | `--fg-muted` |
| Restore (additive) | `rotate-ccw` | restore-as-new-version | `--fg-muted` |
| Tombstone (not erase) | `archive` | tombstoned under retention | `--fg-subtle` |
| Share (isolated origin) | `link-2` / `share-2` | share link w/ password+expiry | `--fg-muted` |
| Search inside content | `search` / `file-search` | full-text over content | `--fg-muted` |
| Success / confirmed | `check-circle-2` | success toast, completed op | `--status-verified` |
| Informational notice | `info` | info toast / neutral notice | `--status-info` |
| Sign in / session start | `log-in` | authentication, sign-in | `--fg-muted` |
| Sign out / session end | `log-out` | sign out | `--fg-muted` |
| Upload / ingest in progress | `upload-cloud` | drop zone, uploading row | `--fg-muted` |
| Offline / no connection | `cloud-off` | offline state | `--fg-subtle` |
| Retry / refetch | `rotate-cw` | retry a failed fetch (distinct from restore `rotate-ccw`) | `--fg-muted` |

The **document-stack** motif (Lucide `layers`/`files`, echoing the logo's three offset sheets) is the app's signature illustration — used in every empty state, the app icon, and loading splash.

---

## 7. Component library

Anatomy + full state matrix (default / hover / focus-visible / active / disabled / loading). ASCII for the signature compliance components.

### 7.1 App shell

```
┌────────────────────────────────────────────────────────────────────────┐
│ [◧] Doc-Hub          ⌘K Search inside documents…            🔒 ⌄ schnsrw │ 48px top bar
├──────────┬─────────────────────────────────────────────────────────────┤
│ SIDEBAR  │  Breadcrumb ▸ Project ▸ Folder            [+ New] [↑ Upload]  │ 36px toolbar
│ 240px    │ ┌─────────────────────────────────────────────────────────┐ │
│          │ │  Name            Ver  Status      Modified       Size    │ │ header 36px
│ Personal │ ├─────────────────────────────────────────────────────────┤ │
│  locker  │ │ 📄 Contract.pdf  v12  🔒✓ intact  2h ago    tabular     │ │ row 32px
│ ─────────│ │ 📄 Q3.xlsx       v3   ⚖ hold      1d ago    tabular     │ │
│ Projects │ │ …                                                        │ │
│  Legal   │ └─────────────────────────────────────────────────────────┘ │
│  Finance │                                                              │
│ ─────────│                                                              │
│ Activity │                                                              │
│ Trash    │                                                              │
│ ─────────│                                                              │
│ 🔒 Encrypted at rest · AES-256-GCM        ← always-on status chip       │
└──────────┴─────────────────────────────────────────────────────────────┘
```

- **Sidebar (240px):** app mark top-left; sections `Personal locker` (unremovable, `lock` glyph) · `Projects` (per-project, role dot) · system (`Activity`, `Trash`). Item 28px, `--radius-sm`, hover `--bg-hover`, selected `--bg-selected` + 2px left amber rule + bold label. Collapses to 56px icon rail. **Encryption status chip pinned to sidebar footer, always visible** — `lock` + "Encrypted at rest · AES-256-GCM", `--fg-subtle`, non-interactive, tooltip explains envelope scheme.
- **Top bar (48px):** logo mark (links home) · centered command-K trigger (`search` icon + "Search inside documents…" + `⌘K` kbd chip) · right: key-status `lock`/`key`, account menu. Height fixed, `--shadow-sm` only when content scrolls under.
- **Command-K (cmdk):** centered modal, 560px, `--bg-raised`, `--shadow-md`, `--radius-lg`. Two zones: content search (Tantivy full-text, snippet + highlight) and commands. AI answers appear as a read-only suffixed block labeled "AI · read-only" (`sparkles`), never mutates. States: empty (recent + shortcuts), typing (skeleton rows), results, no-results (registry motif), error.

### 7.2 Document table row (signature)

```
 ┌──┬─────────────────────────┬──────┬───────────────┬──────────┬────────┐
 │▢ │ 📄  Master-Agreement.pdf │ v12  │ 🔒 ✓ intact   │ 2h ago   │ 1.4 MB │
 └──┴─────────────────────────┴──────┴───────────────┴──────────┴────────┘
  ↑    ↑   ↑                     ↑      ↑                ↑          ↑
  sel  ic  name (13px/500)      ver    status cluster   modified   size
       16  fg-default           mono   icon+label       sm/muted   mono tnum
```

Columns: `[checkbox 24] [icon 16] [name flex] [version 56 mono] [status ~140] [modified 96] [size 72 mono]`. Row 32px, cell pad-x 12px.

- **Version column:** `v12` in mono, tabular, `--fg-muted`; click opens version history panel.
- **Status cluster (load-bearing):** compact icon+label chips — `lock` (encrypted, ambient `--fg-subtle`), `shield-check` "intact" (`--status-verified`) OR `shield-alert` "tamper" (`--status-danger`), `gavel` "hold" (`--status-attention`), `badge-check` "signed". Icons always paired with a label or a labeled tooltip.

States:
- **default:** `--bg-surface`, hairline bottom border.
- **hover:** `--bg-hover`; row actions (`download`, `share`, `history`, `⋯`) fade in right-aligned at `--dur-instant`.
- **focus-visible:** `--shadow-focus` inset ring, full row focusable, arrow-key navigable.
- **active/selected:** `--bg-selected` + 2px left amber rule + checked box. Bulk selection raises the selection bar.
- **disabled (held/processing):** `--fg-disabled` text, actions that violate hold are removed (not greyed), `gavel` chip shown.
- **loading:** skeleton row — shimmer bars at name/version/size widths, `--dur-base` pulse.
- **editing (co-edit):** small avatar stack + `pencil` glyph, live.

### 7.3 Version-history timeline + hash-chain visualization (signature, core compliance)

Right-docked panel, 360px. Newest at top (matches the logo stack — newest sheet forward). Each node shows seq, author, reason, timestamp, and the chain link to `prev_hash`.

```
┌ Version history — Master-Agreement.pdf ───────────────── [Verify chain] ┐
│                                                                          │
│  ●  v12  current            2h ago · schnsrw                             │
│  │       reason: "signed final"                                         │
│  │       content_hash  9f3a…c1  ⧉                                       │  mono/tnum
│  │       ✓ link intact                                     [Restore ⤴]  │
│  ┿  ← link (shield-check, --status-verified)                            │
│  ○  v11                     1d ago · aria                               │
│  │       content_hash  71bd…8e  ⧉   prev 9f3a…c1                        │
│  │       ✓ link intact                                                  │
│  ┿                                                                       │
│  ○  v10                     3d ago · schnsrw                            │
│  │       content_hash  4c8e…2a  ⧉   prev 71bd…8e                        │
│  ┋                                                                       │
│  ⛓✗ v7 → v6   LINK BROKEN                                    [Details]  │  --status-danger
│                                                                          │
├──────────────────────────────────────────────────────────────────────── ┤
│  Chain: 12 versions · ✓ 11 links verified · ✗ 1 broken   Exported ⧉     │
└──────────────────────────────────────────────────────────────────────── ┘
```

- **Node:** filled `●` = current, hollow `○` = prior, `git-commit-horizontal`. Vertical `│` connector is the chain; a verified segment shows `┿`/`shield-check` in `--status-verified`; a broken segment shows `⛓✗`/`unlink` in `--status-danger` with a persistent inline alert.
- **Hashes:** mono, truncated `9f3a…c1`, click-to-copy (`copy` glyph, toast "Hash copied"). Full hash on hover tooltip.
- **Verify chain button:** primary panel action → runs `verify_chain`, streams node-by-node check (spinner per node, resolves to check/alert). Result footer summarizes `n verified · m broken`.
- **Restore:** `rotate-ccw` "Restore as new version" — copy makes additivity explicit; confirms in dialog; appends v13, never mutates.
- **Export:** offline-verifiable provenance bundle (`download`), footer link.
- States: loading (skeleton nodes), verifying (per-node spinners), all-intact (green summary), tamper (danger summary + top-of-panel banner), empty (single version → "One version. History begins here." + stack motif).

### 7.4 Audit-trail row (core compliance)

Append-only, day-grouped, hash-chained like versions. Never editable.

```
  ── Today ───────────────────────────────────────────────────────────────
  14:22  ✓  schnsrw  signed        Master-Agreement.pdf  v12   #a91f…  ⧉
  13:05  ↑  aria     uploaded      Q3-forecast.xlsx      v1    #77c2…  ⧉
  11:40  ⚖  schnsrw  placed hold   Contract-2019.pdf            #4e0a…  ⧉
  ── Yesterday ────────────────────────────────────────────────────────────
  18:10  ⤴  aria     restored      Policy.md  v9→v10            #10bd…  ⧉
```

- Row 32px: `time (mono/tnum) · event-icon · actor · verb · target · version · event-hash(mono) · copy`. Verb-first, present/past terse. Event hash mono, click-to-copy.
- No hover actions that mutate (append-only). Hover reveals full timestamp + `prev_hash` tooltip.
- Filter bar (actor, action, date range, project) + `Export` (JSONL / PDF, offline-verifiable). Footer: "Append-only · hash-chained · N events".
- States: default, loading (skeleton), empty ("No activity yet." + `scroll-text`), filtered-empty, export-in-progress.

### 7.5 Verification badge (intact / tamper)

```
INTACT:   ┌ shield-check  Verified ┐   fg=--status-verified, border-hair,
          └──────────────────────┘    bg=transparent, 20px tall, radius-xs

TAMPER:   ┌ shield-alert  Tamper detected ┐  fg=--status-danger,
          └────────────────────────────────┘  bg=rgba(163,44,34,0.08),
                                               border=1px --status-danger
```

- Two variants only: **intact** (icon `shield-check`, label "Verified", muted forest) and **tamper** (icon `shield-alert`, label "Tamper detected", brick, subtle fill + border). Icon + label always both present. Never color-only.
- Sizes: inline (20px, row status cluster) and block (used in provenance card / panel header).
- Tamper is an **alarm**: block variant is persistent, cannot be dismissed without resolution, links to affected version(s) and audit. Announced `role="alert"`, `aria-live="assertive"`.

### 7.6 Encryption / lock badge (ambient)

- `lock` glyph + optional "Encrypted" label. Ambient `--fg-subtle` — encryption is the default, not an alert, so it is quiet. Tooltip: "Encrypted at rest · AES-256-GCM · per-workspace key". Appears in the status cluster, editor chrome, and always-on in the sidebar footer. `key`/`key-round` variant surfaces key/rotation status in admin.

### 7.7 Retention / legal-hold banner

```
┌────────────────────────────────────────────────────────────────────────┐
│ ⚖  Legal hold  ·  This document is under hold since 2026-03-11.         │
│    Deletion, tombstoning, and purge are blocked. Placed by schnsrw.     │
│                                              [View hold]  [Audit trail]  │
└────────────────────────────────────────────────────────────────────────┘
  fg=--fg-default, icon=gavel --status-attention, bg=--accent-wash,
  left rule 3px --status-attention, radius-md, padding 12px
```

- **Legal hold:** `gavel`, amber, explains what is blocked (delete/tombstone/purge) + who placed it + when. Actions that violate the hold are removed from menus, not disabled-with-tooltip only (belt and suspenders: also a toast if attempted via keyboard).
- **Retention:** `clock`/`hourglass`, amber when due/soon, subtle when far. Shows policy + eligible-purge date; countdown tabular. Tombstone (`archive`) copy makes clear bytes are not erased under hold.
- States: active hold, retention-due (amber), retention-far (subtle/neutral), released (transient success toast, banner removed, audit entry).

### 7.8 Provenance / signature card

```
┌ Provenance ─────────────────────────────────────────────────────────────┐
│  badge-check   Signed                                       ✓ Verified   │
│  Issuer      CasualOffice Registry  (Ed25519)                            │
│  Fingerprint 3b9f a204 …  c17e            ⧉                              │  mono/tnum
│  Signed at   2026-07-05 14:22:07 UTC                                     │
│  Version     v12 · content_hash 9f3a…c1   ⧉                              │
│  ───────────────────────────────────────────────────────────────────    │
│  [Verify signature]              [Export offline-verifiable bundle]      │
└──────────────────────────────────────────────────────────────────────────┘
```

- `badge-check`/`stamp`. Fields mono where cryptographic (fingerprint, hash), tabular timestamps. Verify runs Ed25519 check → intact/tamper badge. Unsigned state: neutral "Not signed" + "Sign this version" action (role-gated).

### 7.9 Buttons

Heights 24/28/32. `--radius-sm`. Label `--text-md` 500. Icon 16px, 8px gap.

| Variant | Rest | Hover | Focus | Active | Disabled | Loading |
|---|---|---|---|---|---|---|
| **Primary** | `--accent` bg, `--accent-fg` | `--accent-hover` | +`--shadow-focus` | `--accent-press`, translateY 1px | `--fg-disabled` bg, no shadow | spinner replaces icon, label stays, `aria-busy` |
| **Secondary** | `--bg-raised`, `--border-strong`, `--fg-default` | `--bg-hover` | +ring | `--bg-active` | 40% opacity | inline spinner |
| **Ghost/tertiary** | transparent, `--fg-muted` | `--bg-hover` | +ring | `--bg-active` | 40% opacity | spinner |
| **Danger** | transparent, `--status-danger` text + border | `rgba(163,44,34,0.08)` | +ring | darker | 40% | spinner |
| **Icon** | 28×28, ghost | `--bg-hover` | +ring | `--bg-active` | 40% | spinner |

One primary per surface. Amber primary is the single chroma point on most screens.

### 7.10 Inputs

30px tall, `--radius-sm`, `--bg-sunken`, `1px --border-strong`, `--text-md`. Label 12px `--fg-muted` above; helper/error 11px below.

- **focus-visible:** `--border-focus` + `--shadow-focus`.
- **error:** `--status-danger` border + `shield-alert` icon + message ("what + what next").
- **disabled:** 50% opacity, `not-allowed`.
- **loading/validating:** trailing spinner.
- Search input (top bar/command-K) carries `search` icon lead + `⌘K` kbd chip. Password/share fields show strength + `lock`.

### 7.11 Dialogs (Radix)

Centered, 440–560px, `--bg-raised`, `--radius-xl`, `--shadow-lg`, 20px padding. Overlay `rgba(22,22,26,0.40)`. Title `--text-lg`, body `--text-base`, footer right-aligned (secondary + primary). Focus trapped, `Esc` closes (except destructive-confirm requires explicit action). Uses: new project, move, share options, **legal-hold confirm** (blocks tombstone; explains consequences; requires typed/checkbox confirm), restore-as-new confirm. Reduced motion → fade only.

### 7.12 Toasts (sonner)

Bottom-right, `--bg-raised`, `--radius-md`, `--shadow-md`, `--text-sm`, max 4 stacked, auto-dismiss 4s (errors persist until dismissed). Verb-first: "Uploaded 3 documents", "Version 13 saved", "Hold placed". Undo affordance for safe ops (`rotate-ccw` "Undo", 8s). Hold-skipped batch: "Moved 4 · 1 skipped (under hold)" with `gavel`. Icon per status, label always present. `aria-live="polite"` (errors `assertive`).

### 7.13 Skeletons

Content = skeletons, not spinners. Shimmer: `--bg-sunken` base → `--bg-hover` sweep, `--dur-slow` loop, disabled under reduced motion (static `--bg-sunken`). Table skeleton mirrors real column widths (name/version/status/date/size). Panels show node/field skeletons. Spinners reserved for finite system tasks: verify-chain per-node, sign, export, upload progress.

---

## 8. Compliance & security UI patterns

Trust is ambient where it is the default, loud where it is an exception.

1. **Chain integrity is always visible.** Every document row carries its verification state in the status cluster; the version panel renders the literal hash chain with per-link intact/broken markers. Verified is quiet (`shield-check`, muted forest); the chain is never presented without the option to `Verify`.
2. **Tamper is a first-class alarm.** A failed `verify_chain` or signature check produces a persistent block-level alert (`shield-alert`, brick, subtle fill + 1px border), `role="alert"` `aria-live="assertive"`, that names the affected version(s), links to the audit entry, and cannot be dismissed without resolution. Never a silent tint; never auto-repaired (matches the append-only invariant).
3. **Encrypted-at-rest is ambient and permanent.** The sidebar footer chip ("Encrypted at rest · AES-256-GCM") is always on and non-interactive; per-document `lock` sits quietly in the status cluster. Encryption is the default state, so it reads calm — but it is never hidden. There is no UI to turn it off (boot refuses without a key).
4. **Holds and retention are lockouts, shown before the action.** Held documents show the amber `gavel` banner; operations that would violate a hold are *removed* from menus (not merely disabled) and, if reached by keyboard, blocked with an explaining toast. Retention shows policy + eligible-purge date with a tabular countdown; tombstone copy (`archive`) states bytes are retained, not erased.
5. **Provenance is showable and exportable.** Signed versions surface the provenance card (issuer, Ed25519 fingerprint, signed-at, bound version hash) with a Verify action and an offline-verifiable export bundle. Unsigned is neutral, not alarming.
6. **Append-only is legible.** Audit and version surfaces state "Append-only · hash-chained" in their footer, offer no edit/delete affordances on committed rows, and frame "restore"/"delete" as additive (`rotate-ccw`, tombstone) in both icon and copy.
7. **Isolated share origin is signaled.** Share dialogs state the link lives on the user-content origin, require optional password (Argon2id) + expiry, and show a revoke control; the recipient page shows a minimal, cookieless, read-only chrome with the `lock` badge and no app navigation.
8. **Keys and sessions are inspectable.** Admin key-status surfaces (`key-round`) show KEK/DEK/rotation state without ever exposing key material (mirrors "keys never appear in UI"). Session and OIDC state live in account settings with last-active and revoke.

---

## 9. Accessibility (WCAG 2.1 AA)

1. **Contrast.** Body text `--fg-default` on `--bg-canvas` ≈ 14:1; `--fg-muted` `#45454B` on paper ≈ 8.6:1 (AA for all text). **`--fg-subtle` `#8A8A92` on paper is only ≈3.1:1 — it does NOT meet AA for text.** Use `--fg-subtle` for non-text/decorative marks (hairlines, rest-state illustration glyphs) or large text (≥18px, or ≥14px bold) only — never for body or metadata text. **Amber `--accent` `#B7791F` on paper is only ≈3.28:1 — NOT AA for text.** Use `#B7791F` for fills/icons/borders (≥3:1 non-text) only; use `--amber-700` `#8F5F17` (≈4.96:1) for **all** amber text. **Status text must use the `-700` step (§2.5):** `--status-verified-700` `#2F6B4F` ≈5.7:1, `--status-attention-700` `#8F5F17` ≈4.96:1, `--status-danger-700` `#A32C22` ≈6.4:1, `--status-info-700` `#45454B` ≈8.6:1 — all ≥4.5:1 on paper. Base `--status-*` values are non-text (fills/icons) only.
2. **Never color alone (1.4.1).** Every amber/verified/danger signal pairs with a Lucide icon **and** a text label or labeled tooltip. Disabling color loses no information — enforced by the status-cluster pattern.
3. **Focus-visible.** `--shadow-focus` (2px amber ring, 2px offset) on every interactive element via `:focus-visible`; keyboard-only (no ring on mouse). Focus never suppressed. Contrast of ring ≥ 3:1.
4. **Keyboard-first.** Full app operable without a pointer: `⌘K` command palette, arrow-key row navigation, `Space` to select, `Enter` to open, `/` to focus search, roving tabindex in tables, `Esc` closes overlays. Every important action has an advertised shortcut (kbd chips in menus/tooltips).
5. **Screen readers.** Semantic roles: tables as `grid`, version timeline as ordered `list`, tamper as `role="alert"` `aria-live="assertive"`, toasts `aria-live="polite"`. Hashes have `aria-label` with full value (not the truncated visual). Icons decorative-only get `aria-hidden`; meaningful icons get `aria-label`.
6. **Reduced motion.** `prefers-reduced-motion: reduce` collapses all animation to ≤50ms opacity; no transforms, springs, shimmer, or slide. Verify-chain per-node progress becomes a static count-up.
7. **Targets & spacing.** Interactive targets ≥ 24×24px (dense-mode minimum, AA 2.5.8); 28px default row keeps 24px clickable checkbox/actions. Icon buttons are 28×28.
8. **Text & zoom.** Respects 200% zoom and browser font-size; `rem`-based scale. Minimum in-app text 10px reserved for non-essential caps chips only; essential text ≥ 11px.
9. **Theme & contrast modes.** Light and dark both meet AA; honor `prefers-contrast: more` by promoting `--border-hair`→`--border-strong` and `--fg-subtle`→`--fg-muted`.
10. **Errors.** Programmatically associated (`aria-describedby`), state what happened and what to do next, never rely on placement or color alone.

---

*End of spec. Supersedes `docs/research/04-polish-principles.md`.*
