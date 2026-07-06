# 04 — Premium Document-Table / Registry List Surface Patterns (2026)

**Audience:** the frontend engineer building Doc-Hub's main document pane.
**Purpose:** capture the 2026 state of the art for "list of records" surfaces (Linear, Vercel, Stripe, GitHub, Notion, 1Password, Finder, Arc — plus the consumer file managers Figma/Dropbox/Google Drive as *contrast*), distill the cross-cutting rules, then **replace surface §5 (document list) and §8 (selection bar) in [`../ux/02-surface.md`](../ux/02-surface.md)** with an implementable spec.
**Direction:** Doc-Hub is a **document registry** — documents-only, encrypted at rest, versioned forever. The table shows **type glyphs + metadata**, never thumbnails or media previews. Columns carry the registry's facts: version, updated, kind, encryption, lock. It is not a Drive/Dropbox clone.
**Constraint:** WebSearch only; WebFetch denied on product hosts. Numbers from design-system mirrors / write-ups are flagged `[unverified]` and should be confirmed against the live UI.

---

## TL;DR

- **Row metric:** 32 px × 13 px Inter / 500 is the Linear-derived SaaS benchmark of 2026 ([Linear DS mirror](https://styles.refero.design/style/90ce5883-bb24-4466-93f7-801cd617b0d1)). Vercel's May 27 2026 deployments redesign ratified the same pull ("denser layout") ([Vercel changelog](https://vercel.com/changelog/redesigned-deployments-list)). Dropbox 44 px and Google Drive 48–56 px are the "consumery" tells — and both lean on thumbnails Doc-Hub deliberately omits.
- **No thumbnails, no media columns.** Doc-Hub renders a 16 px Lucide **type glyph** per row. No image/video kinds exist in the allowlist; there is nothing to thumbnail. This removes an entire class of hover noise (Google Drive's hovercard, Figma's grid tiles).
- **Registry columns:** Name · **Version** · **Updated** · Kind · **Encryption** · **Lock**. Size optional. `tabular-nums` on every numeric/hash column ([uiprep](https://www.uiprep.com/blog/the-ultimate-guide-to-designing-data-tables)).
- **Hover:** background tint only, no border, no revealed icons, no hover-checkbox. Skip Google Drive's hover-checkmark (users call it "annoying") and Notion's hover-OPEN.
- **Selection:** file-manager convention (click = select, Cmd-click = add, Shift-click = range, double-click = open).
- **Keyboard:** ↑↓ + Enter + Cmd-A + Esc + letter-jump + F2/Enter + Backspace/Delete. Matches ARIA Grid pattern ([ARIA APG Grid](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)).
- **Virtualization:** TanStack Virtual, threshold >100 rows, `useFlushSync: false` for React-19 ([TanStack Virtual](https://tanstack.com/virtual/latest)).
- **Drag-drop:** Atlassian's **Pragmatic drag-and-drop**; external adapter handles OS-file drops, gated by the documents-only allowlist ([Pragmatic DnD](https://github.com/atlassian/pragmatic-drag-and-drop)).
- **Immutability shows in the row.** "Delete" is **Move to trash** = a tombstone under retention, never erasure; a document under **legal hold** or an **open editor lock** cannot be trashed and says so.
- **Density:** ship one (32 px). Sonoma System Settings is the cautionary tale ([Lapcat](https://lapcatsoftware.com/articles/SystemSettings.html)).
- **Motion:** Motion `layout` for FLIP on insert/move/sort ([Motion docs](https://motion.dev/docs/react-layout-animations)); AutoAnimate the one-liner. **No animation on selection.** A committed version never animates in optimistically.
- Doc-Hub spec at bottom replaces §5 + §8 of `02-surface.md`.

---

## Reference list surfaces

**1. Linear — issues list (gold standard).** ~32 px rows default, 28 px in compact `[unverified]`; Inter Variable 510/590, body ~13 px `[unverified]` ([Linear DS mirror](https://styles.refero.design/style/90ce5883-bb24-4466-93f7-801cd617b0d1)). User-reorderable columns via Display menu ([Linear display options](https://linear.app/docs/display-options)). Hover background only, no border ([UI refresh Mar 2026](https://linear.app/changelog/2026-03-12-ui-refresh)). **Focus and selection are separate layers** — arrows move a "cursor," `X` toggles selection, `Cmd-A` all, `Shift-click`/`Cmd-click` work too ([select-issues](https://linear.app/docs/select-issues)). Sort/group in a Display menu, not in headers. Bulk: floating contextual bar. One density.

**2. Vercel — deployments list (immutable records).** May 27 2026 explicitly went **denser**, grouped by status ([deployments redesign](https://vercel.com/changelog/redesigned-deployments-list)). Each row is an immutable deployment: short **mono commit SHA**, author, relative time, status badge — an append-only ledger, never edited in place. This is the closest mainstream analog to Doc-Hub's version chain and to what a document row's Version column points at. Row ~32 px `[unverified]`; hover reveals a row-end `⋯` overflow (explicit affordance, not right-click-only).

**3. Stripe — payments table + event log.** Published Table primitives expose no row-height tokens ([Stripe Apps Table](https://docs.stripe.com/stripe-apps/components/table)). Row click opens a side panel; double-click unused — sidesteps open/select ambiguity. Tabular-nums + right-aligned numerics are the universal standard ([uiprep](https://www.uiprep.com/blog/the-ultimate-guide-to-designing-data-tables), [Carbon DS](https://carbondesignsystem.com/components/data-table/usage/)). The event/log rows are read-only records — the shape of Doc-Hub's audit feed. Hover: light tint; selected: stronger tint + left-edge stripe `[unverified]`. Bulk: top-of-table action bar.

**4. GitHub — commit list + file changes.** The reference for a versioned, hash-linked record. A commit row is short **mono SHA** + author + message + relative time; a "Verified" chip marks a signed commit ([commit signature verification](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification)) `[unverified visual specifics]`. Maps one-for-one to Doc-Hub's version timeline (`seq`, short `content_hash`, author, reason, `created_at`, provenance chip). Diffs use low-saturation add/remove tints and mono gutters — the palette Doc-Hub uses to diff two document versions.

**5. 1Password 8 — hub item list.** Three-pane: sidebar (vaults/categories) → item list → detail ([Knox](https://aliceliao.com/work/knox)). Item rows carry a category glyph + name + subtitle; **security state (lock, category) reads as quiet system chrome**, never decorative. Doc-Hub mirrors this: a document row's Encryption and Lock columns are muted semantic chips, not alarms. Cautionary density: 1P8 cut to ~40 px and was publicly punished ([1P community](https://1password.community/discussion/122677/item-list-information-density-in-1pw8)). Doc-Hub stays at 32 px.

**6. Notion — database table.** Every cell editable on click ([Notion tables](https://www.notion.com/help/tables)). Hover reveals **OPEN button**, **⋮⋮ drag handle**, **checkbox** ([Medium](https://medium.com/@VaughanVanDyk/notion-databases-10-things-i-needed-to-learn-52873eb2618b)). Sort/filter in header dropdown; column resize via edge drag. **Lesson: don't reveal too many controls on hover.** Notion's three is busy. Doc-Hub shows **nothing** on hover except a tint.

**7. macOS Finder — list view.** Row ~22 px small / ~38 px medium `[unverified]` — same density philosophy as Linear, twenty years earlier. Column widths not persistable as defaults in list view ([Apple Discussions](https://discussions.apple.com/thread/8304069)) — Doc-Hub must persist them to surpass Finder. Rename: `Return` enters rename, extension *not* selected ([Apple Discussions](https://discussions.apple.com/thread/255445067)). Right-click is the primary command surface.

**8. Arc — sidebar Tabs.** ~36 px rows with `padding: 0 12px` flexbox ([ArcWTF CSS](https://github.com/KiKaraage/ArcWTF/blob/main/README.md)). Subtle hover bg, no border. Three visual tiers distinguished by spacing and size, not color ([Blake Crosley](https://blakecrosley.com/guides/design/arc)). **Lesson: when 30+ rows stack in a scrollable column, the row component is the brand.**

**9. Consumer file managers — Figma / Dropbox / Google Drive (contrast, do NOT copy).** These are the Drive-clone surfaces Doc-Hub deliberately is not:
- **Figma** — grid default, 16:9 thumbnails from 1920×1080 source ([thumbnail guide](https://help.figma.com/hc/en-us/articles/360038511413-Set-custom-thumbnails-for-files)). Thumbnails *are* the UI. Doc-Hub has no thumbnails.
- **Dropbox** — ~44 px rows to fit avatar + thumbnail; hover reveals inline share/⋯ icons ([redesign](https://www.techspot.com/news/100467-dropbox-rolls-out-redesigned-web-interface-releases-new.html)). Looser row is a consumer choice.
- **Google Drive** — ~48–56 px rows for owner avatar + hover thumbnail; the May 2024 **hovercard preview** ([Workspace Updates](https://workspaceupdates.googleblog.com/2024/05/preview-files-in-google-drive-with-hovercards.html)) is polarizing and the hover-checkbox is publicly called "annoying" ([community thread](https://support.google.com/drive/thread/205464794/when-we-hover-mouse-on-a-file-folder-it-shows-a-selection-option-as-a-checkmark-which-is-annoying)).
- **Worth stealing (only):** the selection-aware action bar (Dropbox), shared-with badges (Google Drive). **Rejected:** thumbnails, hovercards, hover-checkboxes, media previews, 44 px+ density, "put anything here" storage framing.

---

## Synthesis

**Row height.** 32 px = 2026 benchmark. 28 px is floor. 36–40 px = "comfortable". >44 px = consumer (and usually thumbnail-driven). **Doc-Hub: 32 px.**

**Type.** Body 13 / Inter 500. Metadata 12 muted. Header 11 uppercase + `letter-spacing: 0.04em`. Tabular-nums on every numeric column; **mono** on `content_hash` (short form) and version.

**No thumbnails.** The documents-only allowlist (`docx, xlsx, csv, xlsm, pptx, pdf, md, txt, json, yaml`) has no image/video kind. The row leads with a 16 px Lucide type glyph. This is a deliberate simplification, not a gap — it removes hovercards, grid tiles, thumbnail workers, and the media-preview attack surface in one stroke.

**Hover.** Background tint only. Linear/Vercel/Notion/Stripe/GitHub: tint only. Dropbox/Google Drive: tint + revealed icons + thumbnail (consumer tell). **Doc-Hub: tint only**; inline actions live on focus, selection, or right-click, never hover.

**Selection.** File-manager model (click = select, Cmd-click = add, Shift-click = range). Users arrive with Finder/Explorer muscle memory.

**Keyboard.** ARIA Grid ([W3 ARIA APG Grid](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)): ↑↓ move focus+selection · Home/End · PgUp/PgDn · Enter open (folder navigates, document opens the embedded editor) · Cmd-A select all · Esc clear · Cmd-click toggle · Shift-click / Shift-↑↓ range · letter-key jump (sticky 1 s) · F2 or Enter rename · Backspace/Delete → Move to trash (tombstone).

**Virtualization.** TanStack Virtual is the React-19 default. Threshold >100 rows, `useFlushSync: false`, `estimateSize: 32`, `overscan: 5`. Selection `Set<id>` outside the virtualizer.

**Drag-drop.** **Pragmatic drag-and-drop** powers Trello/Jira/Confluence ([repo](https://github.com/atlassian/pragmatic-drag-and-drop)); external adapter handles OS-file, **filtered by the documents-only allowlist** — a `.mp4` drop is rejected at the dropzone with a clear message, not silently accepted. React Aria `useDragAndDrop` is the pick if RAC is otherwise in the stack ([RAC DnD](https://react-spectrum.adobe.com/react-aria/dnd.html)).

**Immutability in the surface.** Trash is a tombstone under retention, not erasure (the audit chain records it). A document under **legal hold** or with an **open editor lock** cannot be trashed — the action is hidden/disabled with a reason. Restore-from-trash and restore-a-version both append; nothing is destroyed.

**Empty state.** Centered in table viewport. Symbol → title → optional subtitle → optional CTA ([Eleken](https://www.eleken.co/blog-posts/empty-state-ux), [Carbon DS](https://carbondesignsystem.com/patterns/empty-states-pattern/)).

**Density.** Ship one. Linear/Vercel/Stripe/Notion all do.

**Motion.** Motion `layout` for FLIP on insert/move/sort ([Motion](https://motion.dev/docs/react-layout-animations)); AutoAnimate the one-liner. No animation on selection. A **committed version is not optimistic** — the row's Version column updates only after the server confirms the append.

**Skeleton.** 8 rows at exact row footprint, 1.2 s shimmer ([Mat Simon](https://www.matsimon.dev/blog/simple-skeleton-loaders)).

---

## Doc-Hub surface spec — main document pane (replaces §5 of `02-surface.md`)

Tokens reference `04-polish-principles.md` §"Starter Token Set".

### Layout (top of pane, downward)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [ + New ▾ ]   [ ⬆ Upload  U ]                                       [ Search ] │  toolbar 44 px
├──────────────────────────────────────────────────────────────────────────────┤
│ Home › Reports › Q2                                                           │  breadcrumbs 32 px
├──────────────────────────────────────────────────────────────────────────────┤
│ NAME ▲                        VER    UPDATED       KIND        🔒   ENC       │  sort header 32 px, sticky
├──────────────────────────────────────────────────────────────────────────────┤
│ 📁  Drafts                     —     yesterday     Folder       —    —        │  row 32 px
│ 📄  Budget Q2.xlsx            v7     2 hrs ago     Spreadsheet  —    ✓        │
│ 📄  Policy.docx               v3     last week     Document     🔒   ✓        │  legal hold / lock
│▌📄  Notes.md      [Editing]  v12     10 min ago    Markdown     ✎    ✓        │  editor session, left stripe
│ 📄  data.json                v1     3 days ago     JSON         —    ✓        │
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │  skeleton
└──────────────────────────────────────────────────────────────────────────────┘
                                            (selection bar floats at bottom — §8 below)
```

There is no List/Grid toggle: Doc-Hub is list-only (no thumbnails to grid). The former view-toggle slot holds an inline content-search field instead.

### Pane-top toolbar

44 px, padding `--space-3` × `--space-6`, `--bg-default`, hairline bottom, sticky.

- **New ▾**: ghost split-button + chevron, 13/500, `--radius-md`. Dropdown: New folder (⌘⇧N) · Upload document (U) · Create document ▸ (Sheet / Doc / Markdown).
- **Upload**: primary fill (`--accent` / `--fg-onAccent`), `upload-cloud` 16, chord chip `U` muted right. Rejects non-allowlisted types at the picker and the dropzone.
- **Search**: inline field (or `/` to focus) querying document *content* + metadata; hands off to the Cmd-K palette for advanced filters.

### Breadcrumbs band

32 px, 13 px / 500, current segment `--fg-default`, others `--fg-muted`, `›` separator 12 px `--fg-subtle`. Long paths collapse to middle ellipsis dropdown.

### Sort header

32 px, `--bg-default`, hairline bottom only, sticky under breadcrumbs. Type 11 px / 500 / `--fg-muted` / `letter-spacing: 0.04em` / uppercase. Active column: `--fg-default` + 12 px ▲/▼ in `--accent`. Click toggles asc → desc → clear (back to default updated-desc). Resize handle between header cells on hover.

### Columns

- **Name** — flex min 240, left, 13/500, type glyph 16 px. Ellipsis truncate.
- **Version** — 64 px, left, `--font-mono` 12/400 muted, `v<seq>` (e.g. `v7`); tooltip shows short `content_hash` + author of the head version; click opens the version timeline.
- **Updated** — 144 px, left, 13/400 muted, tabular-nums, relative ("2 hrs ago", "yesterday", "3 May").
- **Kind** — 128 px, left, 13/400 muted, one word from the allowlist ("Folder", "Document", "Spreadsheet", "PDF", "Markdown", "JSON", "YAML", "CSV", "Text").
- **Lock** — 40 px, center. Empty by default. `lock` glyph (`--fg-muted`) = legal hold or admin lock; `pencil`/`✎` (`--accent`) = an open editor session; tooltip names who/why. A locked/held row disables trash.
- **Encryption** — 40 px, center. `shield-check` (`--fg-muted`) = encrypted at rest with the workspace DEK (the normal, universal state — every document is encrypted); on the rare key-state issue (e.g. rewrapping during rotation) a `shield-alert` (`--warning`) with tooltip. Never absent, since encryption is not optional.
- **Size** — optional, 96 px, right, 13/400 muted, tabular-nums; hidden by default to keep the registry columns primary.

All sortable except Lock/Encryption (filterable instead). Widths persist per user in IndexedDB.

### Row tokens

**32 px** fixed. Padding `--space-3` left / `--space-4` right. Transparent (no zebra). Bottom grid line: 1 px `--border-default` at 50% opacity. Type glyph: 16 px Lucide (`folder`, `file-text`, `file-spreadsheet`, `file-json`, etc.); tints `--accent` when selected/focused. Name: 13/500/`--fg-default`, ellipsis. Version: mono, muted. Updated/Kind: muted. Lock/Encryption: 14 px glyphs, muted/semantic.

### Row state matrix

- **Default:** transparent. **Hover:** `--bg-hover`, no border, cursor `default`, no revealed controls.
- **Focused (kb):** `--bg-hover` + outer `--focus-ring`, offset (no content shift).
- **Selected:** `--bg-selected` + 2 px `--accent` left-edge stripe. **Selected+hover:** +4% toward accent. **Selected+focused:** stack focus ring.
- **Editor session:** inline `[Editing]` chip (`--bg-accent-muted`, `--accent` text, 11/500, `--radius-xs`) after name; Lock column shows `✎`; tooltip "Editing — open since HH:MM by <user>".
- **Legal hold / locked:** Lock column shows `lock` (`--fg-muted`); trash action hidden; tooltip "On legal hold — cannot be trashed".
- **Uploading ghost:** 60% opacity; glyph overlaid with `upload-cloud`; 2 px determinate `--accent` bar at row bottom, real bytes.
- **Upload rejected (type not allowed):** `--danger-muted` tint; glyph → `alert-circle` `--danger`; tooltip "Only documents can be uploaded (docx, xlsx, pdf, md, …)".
- **Version committing:** brief `--bg-accent-muted` pulse when the head Version increments after a confirmed save — not before.
- **Drag origin:** 40% opacity; cursor carries card.
- **Drop target (folder row only):** `--accent-muted` bg, folder glows `--accent`, 2 px ring; spring-loaded expand after 700 ms.

### Inline rename

Trigger F2, Enter on focused row (slow double-click = rename, fast = open), right-click → Rename. Name cell becomes input matching row typography; extension in `--fg-muted`, not editable without explicit click ([Apple Discussions](https://discussions.apple.com/thread/255445067)). Auto-select basename only. Enter commits, Esc cancels, Tab commits + advances. Rename is metadata-only (does not create a version); optimistic; 409 reverts with 8 px shake, helper "Already a document with that name."

### Multi-select

Click = select single. Cmd-click = toggle. Shift-click = range from anchor. Cmd-A = all in folder. Esc = clear. Shift-↑↓ = extend. Lasso: list view when drag begins in whitespace. State in `Set<file_id>` outside virtualizer.

### Drag-drop

Library: **Pragmatic drag-and-drop** ([repo](https://github.com/atlassian/pragmatic-drag-and-drop)) for in-app row → folder; external adapter for OS-file → window, **allowlist-gated**.

- Whole row draggable, no visible handle. 4 px start threshold.
- Cursor preview: 32 px floating card at 95% opacity; multi-select shows "(N)" stack badge.
- Drop target (folder row, sidebar folder, breadcrumb segment): bg → `--accent-muted`, folder → `--accent`, 2 px ring.
- Spring-loaded folders: hover > 700 ms → navigate in.
- OS-file overlay: canvas dims to `--bg-subtle` (120 ms); centered 320 × 160 card, dashed 2 px `--accent-muted` border, `upload-cloud` 32 px, caption "Drop documents to upload to *<folder>*". Non-allowlisted files in the drop are rejected with a per-file reason.
- Invalid drop (folder → itself): cursor `not-allowed`, silently ignored.
- Keyboard fallback: Cmd-Shift-M opens Move-to picker.

### Skeleton state

8 rows × 32 px matching layout (16 × 16 glyph block, name flex-fill, version 48, updated 96, kind 80, lock/enc 24). Blocks `--bg-subtle` `--radius-xs`. Shimmer: 1.2 s sweep ([Mat Simon](https://www.matsimon.dev/blog/simple-skeleton-loaders)). `prefers-reduced-motion`: static pulse.

### Empty state (centered, in-table)

```
                              ┌───────────┐
                              │    📄     │   56 px Lucide file-text, --fg-subtle
                              └───────────┘
                       This project has no documents.     20 px / --weight-semibold
                     Upload or create one to start the record.   15 px / --fg-muted
```

Root "first run" variant adds `[ Upload  U ]` primary button below. Search no-results: title `No documents match "<query>".`, subtitle "Search reads inside documents, not just names.", single text-link "Clear search". Fade in 200 ms after skeleton ends. No tutorial overlay.

### Loading on fetch / pagination

Initial: skeleton above. Paginate-on-scroll: append 4 skeleton rows; replace on arrival. Hover pre-fetch on folder > 100 ms → cached → sub-100 ms navigate.

### Error state

```
                              ┌───────────┐
                              │    ⚠     │   56 px Lucide alert-triangle, --warning
                              └───────────┘
                       Couldn't load this project.        20 px / --weight-semibold
                          Check your connection.           15 px / --fg-muted
                            [ Try again ]                 ghost button
```

Same vertical-center layout as empty state. A tamper alarm (a version failing `verify_chain`) uses this frame with `shield-alert` `--danger`, title "Integrity check failed on <document>." and a "View details" link into the provenance panel — it is surfaced, never silently repaired.

### Right-click context menu

Radix ContextMenu at cursor. 220 px wide, `--bg-elevated`, `--shadow-lg`, item rows 28 px / 13 px / 500. Chord chips right-aligned, 11 px `--font-mono`, muted.

- **Document selected:** Open (Enter) · Open in new tab (⇧⏎) — Version history (⌘Y) · Restore version… — Rename (F2) · Move to… (⌘⇧M) · Share… (⌘⇧S) · Copy link — Download (⌘D) · Export provenance — Properties (⌘I) — Move to trash (⌫, disabled under lock/hold).
- **Folder selected:** same minus Open-in-new-tab and version actions; "Open" navigates in.
- **Multi-select:** drops Rename / version actions / Properties; rest scale to selection; footer shows muted "<N> documents".
- **Empty area:** New folder · Upload document · Create document ▸ · Sort by ▸ (Name / Version / Updated / Kind).

### Motion summary

- Insert / sort change / undo: Motion `layout` FLIP, 200 ms `--ease-out`, spring `{400, 30}`. Trash (tombstone): opacity 0 + translateY(-4 px) 200 ms; neighbors FLIP up.
- Hover: `--bg-hover` fade 80 ms. Focus ring: 120 ms. **Selection toggle: none — instant.**
- Version increment: `--bg-accent-muted` pulse 1 cycle (200 ms) **after** server-confirmed commit only.
- Skeleton shimmer: 1.2 s loop. Drop overlay: dim 120 ms + card pop-in.
- Rename: instant; only validation-error shake (8 px / 200 ms / 1 cycle).
- `prefers-reduced-motion`: FLIPs → 0–50 ms crossfade; shimmer → opacity pulse.

### Copy strings (final)

Upload button **"Upload"** + chip `U`. New menu **"New folder"** · **"Upload document"** · **"Create document"**. Empty root: **"This project has no documents."** / **"Upload or create one to start the record."** / CTA **"Upload"**. Empty folder: **"This folder is empty."** / **"Drop documents to add."** / no CTA. Empty search: **"No documents match \"<query>\"."** / **"Search reads inside documents, not just names."** / link **"Clear search"**. Error: **"Couldn't load this project."** / **"Check your connection."** / **"Try again"**. Type-rejected: **"Only documents can be uploaded (docx, xlsx, pdf, md, …)."** Drop caption: **"Drop documents to upload to *<folder>*"**. Editor badge: **"Editing"** / tooltip **"Editing — open since HH:MM"**. Hold tooltip: **"On legal hold — cannot be trashed."**

### Virtualization

TanStack Virtual ([`@tanstack/react-virtual`](https://tanstack.com/virtual/latest)) with `useFlushSync: false` for React 19. Threshold: `rows.length > 100`. `estimateSize: 32`, `overscan: 5`. Selection `Set<id>` outside the virtualizer.

---

## Doc-Hub surface spec — selection bar (replaces §8 of `02-surface.md`)

```
                          ┌─────────────────────────────────────────────────────┐
                          │ 3 selected   ⬇ Download   →  Move…   🔗 Share…   │  │
                          │                             🗑 Trash         ⎋ Clear │
                          └─────────────────────────────────────────────────────┘
                                ▲ floating, bottom-center, 24 px inset
```

### Layout

Fixed bottom-center of main pane, 24 px inset. Width hugs content (min 480, max 720). Height 56 px single row (wraps to 2 below 640 viewport). Background `--bg-elevated` at 80% + `backdrop-filter: saturate(180%) blur(20px)`. Hairline `--border-default`. `--radius-xl`. `--shadow-lg`. `z-index: --z-popover`.

### Contents (left → right)

Count chip `"<N> selected"` (13/500, tabular-nums) → vertical hairline → action chips (32 px, Lucide 16 + label 13/500): **Download** (⌘D) · **Move…** (⌘⇧M) · **Share…** (⌘⇧S, only when exactly 1 selected) → vertical hairline → **Trash** chip in `--danger` text + glyph, no fill (hidden for the whole selection if any item is under lock/hold) → spacer → **Clear ×** tooltip "Clear (Esc)". Chord chips live in tooltips and Cmd-K, not on the bar.

### State matrix

- Hidden (0–1 selected): not rendered.
- Enter (≥ 2 selected): slide up 200 ms `--ease-out` + fade, spring `{400, 30}`.
- Exit: slide down 150 ms `--ease-in` + fade.
- Action in progress: active chip gets 2 px `--accent` progress bar; Esc cancels.
- Action success: chip flashes `--bg-selected` 1 cycle (200 ms); toast confirms ("Moved 3 documents").

### Compact mode (< 640 px)

Chips collapse to icon-only with labels in tooltips. Order preserved. Trash stays in danger color.

### Mixed-selection rules

- Folders + documents: chips that don't apply (e.g. Share when a folder is selected, or version-scoped actions) are **hidden, not greyed** ([Linear changelog: issue selection](https://linear.app/changelog/issue-selection)).
- Any item under legal hold / open editor lock: **Trash is hidden** for the whole selection; tooltip on the count chip explains "N under hold".
- Mixed Download bundles to a zip; label stays "Download".

### Keyboard

`Esc` clears + dismisses. `⌘D` / `⌘⇧M` / `⌘⇧S` / `Backspace` / `Delete` fire respective actions globally (Delete = trash, subject to hold checks).

### `prefers-reduced-motion`

Enter/exit become 100 ms opacity fade.

### Copy strings

- Count: **"<N> selected"** (plural-aware).
- Actions: **Download** · **Move…** · **Share…** · **Trash** · **Clear**.
- Clear tooltip: **"Clear (Esc)"**. Trash tooltip: **"Move to trash (Delete)"**.
- Hold note: **"<N> under hold — can't be trashed."**
- Inapplicable chips: silent (not rendered).

---

## States checklist (test matrix)

**Document list:** Default · Hover · Focused (keyboard) · Selected (single / multi / range) · Inline rename (open / valid / invalid / conflict) · Uploading ghost · Upload rejected (type not allowed) · Version committing · Editor session badge · Legal hold / locked · Integrity-alarm · Drag origin · Drop target (folder / sidebar / breadcrumb) · Skeleton · Empty (root / folder / search) · Error · Right-click menu (document / folder / multi / empty area) · OS-file drop overlay.

**Selection bar:** Hidden · Enter animation · Hover chip · Active chip during in-progress action · Compact viewport · Mixed-selection hiding · Hold-blocks-trash · Exit animation.

---

## Sources

**Linear:** [display](https://linear.app/docs/display-options) · [select](https://linear.app/docs/select-issues) · [inline-edit](https://linear.app/changelog/2022-06-09-inline-editing) · [selection](https://linear.app/changelog/issue-selection) · [UI-Mar2026](https://linear.app/changelog/2026-03-12-ui-refresh) · [DS-mirror](https://styles.refero.design/style/90ce5883-bb24-4466-93f7-801cd617b0d1) · [getdesign.md](https://getdesign.md/linear.app/design-md)

**Vercel:** [deployments-May2026](https://vercel.com/changelog/redesigned-deployments-list) · [redesign-rollout](https://vercel.com/changelog/dashboard-navigation-redesign-rollout) · [changelog](https://vercel.com/changelog)

**Stripe / data tables:** [Apps-Table](https://docs.stripe.com/stripe-apps/components/table) · [uiprep](https://www.uiprep.com/blog/the-ultimate-guide-to-designing-data-tables) · [Carbon-DS](https://carbondesignsystem.com/components/data-table/usage/)

**GitHub:** [commit signature verification](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification) · [comparing commits](https://docs.github.com/en/pull-requests/committing-changes-to-your-project/viewing-and-comparing-commits/comparing-commits)

**1Password:** [Knox by Alice Liao](https://aliceliao.com/work/knox) · [1P8 list density](https://1password.community/discussion/122677/item-list-information-density-in-1pw8)

**Notion:** [tables](https://www.notion.com/help/tables) · [shortcuts](https://www.notion.com/help/keyboard-shortcuts) · [Medium](https://medium.com/@VaughanVanDyk/notion-databases-10-things-i-needed-to-learn-52873eb2618b)

**Finder:** [columns](https://discussions.apple.com/thread/8304069) · [rename](https://discussions.apple.com/thread/255445067) · [Lapcat](https://lapcatsoftware.com/articles/SystemSettings.html)

**Arc:** [Crosley](https://blakecrosley.com/guides/design/arc) · [ArcWTF](https://github.com/KiKaraage/ArcWTF/blob/main/README.md)

**Consumer file managers (contrast):** [Figma thumbnails](https://help.figma.com/hc/en-us/articles/360038511413-Set-custom-thumbnails-for-files) · [Figma browser](https://help.figma.com/hc/en-us/articles/14381406380183-Guide-to-the-file-browser) · [Dropbox redesign](https://www.techspot.com/news/100467-dropbox-rolls-out-redesigned-web-interface-releases-new.html) · [GoodUX Dropbox](https://goodux.appcues.com/blog/dropbox-redesign) · [Google Drive hovercard](https://workspaceupdates.googleblog.com/2024/05/preview-files-in-google-drive-with-hovercards.html) · [hover-checkbox complaint](https://support.google.com/drive/thread/205464794/when-we-hover-mouse-on-a-file-folder-it-shows-a-selection-option-as-a-checkmark-which-is-annoying)

**Virtualization:** [TanStack-Virtual](https://tanstack.com/virtual/latest) · [Borstch](https://borstch.com/blog/development/list-virtualization-in-react-with-tanstack-virtual) · [react-arborist](https://github.com/jameskerr/react-arborist)

**Drag-drop:** [Pragmatic-repo](https://github.com/atlassian/pragmatic-drag-and-drop) · [Pragmatic-docs](https://atlassian.design/components/pragmatic-drag-and-drop) · [RAC-DnD](https://react-spectrum.adobe.com/react-aria/dnd.html) · [MDN file drag-drop](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API/File_drag_and_drop)

**Motion:** [layout](https://motion.dev/docs/react-layout-animations) · [AutoAnimate](https://awesome-react.dev/library/auto-animate) · [MDN reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)

**Skeleton:** [MatSimon](https://www.matsimon.dev/blog/simple-skeleton-loaders)

**Bulk actions:** [Eleken](https://www.eleken.co/blog-posts/bulk-actions-ux) · [PatternFly](https://www.patternfly.org/patterns/bulk-selection/)

**Empty states:** [Eleken](https://www.eleken.co/blog-posts/empty-state-ux) · [Carbon](https://carbondesignsystem.com/patterns/empty-states-pattern/) · [NN/g](https://www.nngroup.com/articles/empty-state-interface-design/)

**Keyboard / a11y:** [ARIA-Grid](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)

**Typography / Inter:** [Inter](https://madegooddesigns.com/inter-font/) · [uiprep data tables](https://www.uiprep.com/blog/the-ultimate-guide-to-designing-data-tables)
