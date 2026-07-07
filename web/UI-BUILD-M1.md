# UI-BUILD-M1 — Doc-Hub design-system transform (Milestone 1)

Frontend-lead implementation plan. Transforms the existing React+Vite SPA at
`web/` from the "Slate Console" cyan theme to the **Doc-Hub** ink/paper + amber
records-tool system. Ground truth: `docs/design/ui-system.md`,
`docs/design/ui-empty-states.md`, `docs/design/ui-phases.md`. Where anything
here conflicts with those, the design docs win.

## Milestone 1 scope (only this)

- **(a) Foundation** — rewrite `src/styles/tokens.css` to the Doc-Hub palette,
  type scale, spacing, radii, shadows, motion + utilities. Swap fonts.
- **(b) App shell** — dense sidebar (projects/system nav + always-on encryption
  footer chip), 48px top bar, `⌘K` command palette. Re-tokenize, no logic rip-out.
- **(c) Vault list** — dense document table: `Name / Kind / Version / Updated /
  Lock / Encryption` columns, header row, hover/selected/focus states, skeleton.
- **(d) Empty states** — reusable `EmptyState` with registry (layers) motif +
  overlay glyph; wire the vault list-empty and first-run copy.

**Out of scope this milestone** (later phases per `ui-phases.md`): version-history
panel, audit-trail restyle, provenance/signature cards, verify-chain, holds,
editors, Settings/Admin/Notes restyle. Do **not** touch those surfaces beyond
what a global token swap gives them for free.

**Docs-only guardrail:** on the surfaces we touch, remove video/`@vidstack` and
media-preview affordances (no video kind label, no video branch in the vault
row/thumb path). Do not delete `@vidstack` from `package.json` this milestone —
other untouched pages import it; just stop referencing media preview in the
shell/vault surfaces.

## Hard constraints (enforced in review)

- **Dense:** table rows ≤ 32px (28px compact), header 36px, sidebar item 28px,
  top bar 48px, cell pad-x 12px / pad-y 6px, gutters 8/12/16px. Reject ≥40px rows
  and ≥32px section padding.
- **Ink/paper + amber only.** No cyan, no per-filetype chroma in the vault row.
- **Amber text must be `--amber-700` `#8F5F17`** (AA 4.96:1). `#B7791F` is
  fills/icons/borders only. `--fg-subtle` `#8A8A92` is non-text/decorative only.
- **Amber never alone** — every amber/status signal pairs icon + label/tooltip.
- **Focus-visible** amber ring on every interactive element; keyboard operable.
- **`prefers-reduced-motion`** honored (already global in tokens.css — keep it).
- **No fake data.** The API exposes `version:number` and `status` (upload state)
  only — no hash chain, no per-doc verification. Show `lock` (encrypted-at-rest,
  a product invariant per `CLAUDE.md`) as an **ambient** cluster item; do **not**
  render "intact/tamper/hold/signed" chips — those need Phase-1 endpoints.
- **`pnpm build` must stay green** (`tsc --noEmit && vite build`). Do not remove
  routing, data fetching, auth/state/presence, or event wiring.

---

## Ground truth from the current codebase

- **Entry:** `src/main.tsx` imports fonts + `./styles/tokens.css` (+ dialog/notes
  css), renders `<App/>`. `src/App.tsx` = router + providers
  (`AuthProvider → WorkspaceProvider → PresenceProvider → Router`) + sonner
  `<Toaster>` (currently `background: var(--ink)` cyan-slate).
- **Shell:** `src/pages/Shell.tsx` — `<Sidebar>` (248px) + column with `<TopBar>`
  (home only) + `<main>`; `nav` state routes home/notes/recent/starred/shared/
  trash/activity/admin/settings; mounts `<CommandPalette>`, `<HelpModal>`.
- **Vault:** `src/pages/Files.tsx` (owns fetch/search/upload/select/sort; renders
  `GridView`/`ListView`, `GridSkeleton`, `EmptyState`) and `src/components/FileRow.tsx`
  (`Row` grid: `minmax(0,1fr) 160px 96px 120px` = name/modified/size/kind, 32px).
  API: `api.listRoot(workspaceId)` / `api.getFolder(id)` →
  `{folders:FolderDto[], files:FileDto[]}`; search via `searchAdvanced`.
- **Types (`src/api/client.ts`):** `FolderDto {id,parent_id,name,created_at,modified_at}`;
  `FileDto {id,parent_id,name,size,content_type,version:number,created_at,
  modified_at,status?:"uploading"|"ready"|"failed",thumbs_state?,thumb_urls?}`.
- **Fonts installed:** only `@fontsource-variable/ibm-plex-sans` +
  `@fontsource/ibm-plex-mono`. Inter / JetBrains Mono are **not** installed yet.
- **Deps present:** `lucide-react` 0.469, `cmdk`, `radix-ui`, `sonner`. Good.
- **Theming mechanism (keep it):** single global `tokens.css` with `@import
  "tailwindcss"`, `:root` custom props, `[data-theme="dark"]` + `prefers-color-scheme`
  mirrors, a Tailwind v4 `@theme` bridge, and base/utility rules. All components
  style via `var(--token)` inline styles. **We keep exactly this mechanism** —
  one stylesheet of tokens + utilities; no CSS-in-JS lib, no new provider.

---

## CSS / token strategy

One global stylesheet, `src/styles/tokens.css`, fully rewritten to the Doc-Hub
system, preserving the existing structure so nothing downstream breaks:

1. **Keep every token *name* the app already consumes** and repoint its *value*.
   The codebase reads `--paper --card --ink --ink-soft --muted --muted-2 --accent
   --accent-hover --fg-onAccent --line --line-strong --bg-hover --bg-row-hover
   --bg-selected --bg-subtle --bg-overlay --rail --rail-2 --rail-text --rail-muted
   --rail-active --rail-active-text --rail-line --shadow* --radius* --space* --text*
   --weight-* --font-sans --font-display --font-mono --dur-* --ease*`. Remap:
   - `--paper → #F5F3EE` (bg-canvas), `--card → #FBFAF6` (bg-surface),
     `--ink → #16161A`, `--ink-soft → #45454B`, `--muted → #45454B` (fg-muted),
     `--muted-2 → #8A8A92` (fg-subtle — non-text only).
   - `--accent → #B7791F`, `--accent-hover → #A56D1B`, `--fg-onAccent → #FFFFFF`.
   - `--line → rgba(22,22,26,0.08)`, `--line-strong → rgba(22,22,26,0.16)`.
   - `--bg-hover → rgba(22,22,26,0.04)`, `--bg-row-hover` same 0.03,
     `--bg-selected → rgba(183,121,31,0.10)`, `--bg-overlay → rgba(22,22,26,0.40)`.
   - **Rail is now the dark ink surface** (paper is default light, but the sidebar
     stays a dark rail per shell §7.1 dark-on-light contrast — use ink ramp, not
     cyan slate): `--rail → #1E1E23`, `--rail-2 → #2A2A30`,
     `--rail-text → #ADADB4`, `--rail-muted → #8A8A92`,
     `--rail-active → rgba(183,121,31,0.14)`, `--rail-active-text → #F5F3EE`,
     `--rail-line → rgba(245,243,238,0.10)`.
2. **Add the Doc-Hub tokens** the design docs name, so buckets 2–4 can use them
   directly: full `--ink-950…--paper-400 --white` ramp, `--amber-700/600/500/100
   --amber-tint`, semantic `--bg-canvas --bg-surface --bg-raised --bg-sunken
   --bg-active --fg-default --fg-muted --fg-subtle --fg-disabled --fg-on-accent
   --fg-on-ink --border-hair --border-strong --border-focus --accent-press
   --accent-wash`, status base + `-700` text steps
   (`--status-verified/-700`, `--status-attention/-700`, `--status-danger/-700`,
   `--status-info/-700`), and `--shadow-sm/-md/-lg/-focus`. Keep old
   `--shadow/--shadow-hover/--shadow-md/--shadow-lg` aliases pointing at the new
   warm-ink shadows so existing consumers don't break.
3. **Type scale → Doc-Hub compact.** Repoint `--text-xs=11 --text-sm=12
   --text-base=13 --text-md=14 --text-lg=16 --text-xl=20` with correct line-heights
   baked into new `--leading-*` or per-utility; add `--text-2xs=10`, `--mono-xs=11`,
   `--mono-sm=12`. Weights: expose `--weight-body:450 --weight-medium:500
   --weight-semibold:600` (drop 300/700 usage; leave the vars defined so no
   reference breaks the build). `--font-sans/-display → 'Inter', system-ui, …`;
   `--font-mono → 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace`.
4. **Dark theme + `prefers-color-scheme` mirrors** rewritten to the §2.6 warm-dark
   values (`--bg-surface #16161A` ground, `--accent #C88A2A`, etc.). Update the
   `@theme` bridge to also expose `--color-amber`, status colors, `--radius-2xs`.
5. **Base + utilities:** `body{font-family:var(--font-sans);font-size:var(--text-base)}`;
   `::selection` amber-tint; `:focus-visible` 2px `--border-focus` ring / 2px offset;
   keep the reduced-motion block. Utilities: `.tnum`/`.tabular-nums`, `.mono`
   (font-mono + tnum), `.hairline`, `.caps-label` (10px/600/+0.04em uppercase
   `--fg-subtle`), `.skeleton` (shimmer `--bg-sunken → --bg-hover`, disabled under
   reduced-motion), `.kbd` chip. Keep the existing `[data-density="compact"]`
   block but repoint the `--cd-list-row-*` values to dense targets (row 32→28,
   pad-y 6→4).

**Font install:** bucket 1 runs `pnpm add @fontsource-variable/inter
@fontsource/jetbrains-mono` and swaps the imports in `main.tsx`. If the registry
is unreachable, fall back to **keeping** the IBM Plex imports and letting the
`system-ui`/`ui-monospace` fallbacks in the font stacks carry it — the build stays
green either way because the font-family strings degrade gracefully. Do not leave
a dangling import of an uninstalled package (that breaks `vite build`).

---

## Shell component tree (bucket 2 target)

```
App (App.tsx)                     Toaster restyle → --bg-raised/--fg-default
└─ Shell.tsx                      bg --bg-canvas; page pad ≤ --space-6 (24px)
   ├─ Sidebar.tsx  (240px rail)   dark ink rail
   │   ├─ Logo + Wordmark         amber square + paper cloud
   │   ├─ WorkspaceSwitcher
   │   ├─ [+ New] primary amber button + NewMenu (folder/doc/sheet/upload)
   │   ├─ Section "Library"  (My Drive, Notes, Recent·soon, Starred·soon, Shared·soon)
   │   ├─ Section "Workspace" (Activity, Admin)
   │   ├─ Section "System"    (Trash, Settings)
   │   ├─ <flex spacer>
   │   ├─ AvatarRow + ThemeToggle
   │   └─ EncryptionFooterChip   NEW — lock + "Encrypted at rest · AES-256-GCM",
   │                             --fg-subtle, non-interactive, tooltip, always on
   ├─ TopBar.tsx  (48px)         search input + view/density toggles + bell + help
   └─ CommandPalette.tsx (⌘K)    cmdk modal 560px, --bg-raised, --shadow-md
```

Bucket-2 rules:
- **Sidebar:** width 248→**240**; item height 28px, `--radius-sm`, label
  `--text-base/450`, icon 16px, gap 8px; hover `--bg-hover`; **active =
  `--bg-selected` + 2px left amber (`--accent`) rule + `--fg-default` semibold**
  (replace cyan wash). Section labels use `.caps-label` (10px/600/+0.04em).
  `[+ New]` = primary amber (`--accent` bg / `--accent-fg`), 28–32px, `--radius-sm`,
  hover `--accent-hover`, press translateY(1px); drop the cyan `--shadow-button`
  lift. NewMenu items → `--bg-raised`/`--border-hair`/`--radius-lg`. Keep all
  callback props + `NavId` union unchanged. Add the always-on encryption footer
  chip below AvatarRow. Icons: `Home, NotebookPen, Clock, Star, Share2, Activity,
  Gauge, Trash2, Settings, Plus, Lock` — Lucide, `strokeWidth={1.5}` (normalize
  from 1.7/2).
- **TopBar:** input 30px, `--bg-sunken`, `--border-strong`, `--radius-sm`,
  `--text-md`; leading `search` icon `--fg-subtle`; focus → `--border-focus` +
  `--shadow-focus`. Toggle groups `--border-hair`/`--radius-sm`; active toggle =
  `--accent-wash` bg + `--fg-default` (not `--ink`/`--paper` invert). Help/bell
  icon buttons 28×28 ghost. Keep all recents/aria/event logic verbatim. Normalize
  strokeWidth to 1.5 and radii to `--radius-sm`.
- **CommandPalette:** token-only restyle — modal `--bg-raised`, `--shadow-md`,
  `--radius-lg`; input row with `search` + `⌘K` `.kbd` chip; group headers
  `.caps-label`; item hover `--bg-hover`, selected `--bg-selected`. Keep cmdk
  wiring, groups (Go to · Folders · Files · Notes), search calls, and the
  `onNavigate/onOpenFile/onOpenNote` contract. No new search behavior (Tantivy is
  Phase 3). Empty/no-results state uses bucket-4 `EmptyState` (registry motif,
  24px, fits 560px).
- **App.tsx:** restyle sonner `<Toaster>` only — `background:var(--bg-raised)`,
  `color:var(--fg-default)`, `border:1px solid var(--border-hair)`,
  `borderRadius:var(--radius-md)`, `boxShadow:var(--shadow-md)`,
  `fontSize:var(--text-sm)`. Do not touch routing/providers.
- **Shell.tsx:** change page container padding from `26px 40px` to `≤ --space-6`
  (24px), background `--bg-canvas`. Leave nav/query/event logic intact.

---

## Vault list surface (bucket 3 target)

The dense document table replaces the current 4-col row. It calls the **existing**
API — `api.listRoot(workspaceId)` / `api.getFolder(id)` in `Files.tsx` (and
`searchAdvanced` for search mode). No new endpoints.

**Columns (grid-template-columns), 32px row / 28px compact:**

| Col | Header | Width | Source | Render |
|---|---|---|---|---|
| Select | (checkbox) | 24px | selection state | 16px box, appears on hover/selected |
| Name | `Name` | `minmax(0,1fr)` | `name` + kind icon | 16px Lucide icon (`--fg-muted`) + `--text-base/500` ellipsis |
| Kind | `Kind` | 96px | `kindLabel(name,ct)` | `--text-sm --fg-muted` (docs only — no Video/Audio/Archive) |
| Version | `Version` | 56px | `file.version` | `.mono --text-sm --fg-muted`, `v{version}` (folders `—`) |
| Updated | `Updated` | 96px | `modified_at` | `formatRelative`, `--text-xs --fg-subtle` **used as ≥ meta only** → use `--fg-muted` for AA |
| Lock | `Lock` | 44px | invariant | `Lock` glyph `--fg-subtle` + tooltip "Encrypted at rest" (ambient) |
| Encryption | `Encryption` | 96px | invariant | status chip: `lock` + "AES-256-GCM" label, `--fg-subtle`, `--text-2xs` |

Notes:
- **Lock + Encryption are the honest M1 status cluster** — encryption at rest is a
  hard product invariant (`CLAUDE.md`), so it is real, not fake. Do **not** add
  intact/tamper/hold/signed columns (no backing data). Version-history click-through
  and those chips land in a later milestone.
- Header row 36px, `.caps-label`-ish `--text-sm/600 --fg-muted`, `--border-hair`
  bottom rule, sticky under the toolbar. Size/right-aligned numeric columns use
  `.mono`/`.tnum`.
- Row states: default `--bg-surface` + `--border-hair` bottom; hover `--bg-hover`
  (kebab/actions fade in `--dur-instant`); focus-visible inset `--shadow-focus`,
  arrow-navigable; selected `--bg-selected` + 2px left amber rule + checked box;
  `status:"uploading"` row = skeleton/`upload-cloud` spinner, `"failed"` =
  `--status-danger` inline label (icon + text). Skeleton mirrors these column
  widths.
- Kind labels: strip Video/Audio/Archive branches from `kindLabel`; the ingest
  allowlist is docs-only. Icon set: `FileText, FileSpreadsheet, File, Folder`
  (drop `Image` primary path is fine to keep for pdf/img thumbs but no media
  preview affordance).

**Files:**
- `src/components/FileRow.tsx` — rewrite `Row` grid + add `KindCol`, `VersionCol`,
  `LockCol`, `EncryptionCol`. `FolderRow`/`FileRowComponent` keep their prop
  signatures; folders render `—` for version/size/encryption. Consumes bucket-4
  `StatusChip`.
- `src/pages/Files.tsx` — add the **table header row** above `ListView`; ensure the
  dense list view is the default framing for the vault (grid view may remain but
  the milestone target surface is the dense table). Repoint container padding to
  `≤ --space-6`, drag-overlay + dropzone colors to amber/paper tokens, `End of
  results` divider to `--border-hair`. Replace the empty-state block copy/props to
  the bucket-4 `EmptyState` contract (below). Do not alter fetch/search/upload/
  selection logic or the event wiring.

---

## Empty states + shared primitives (bucket 4 target)

New folder `src/components/ds/` for shared design-system primitives (no collision
with other buckets):

- `src/components/ds/StatusChip.tsx` — `<StatusChip icon label tone? title?/>`;
  tones `ambient|verified|attention|danger|info` map to `--fg-subtle` /
  `--status-*-700`; **always renders icon + label** (or `aria-label` tooltip).
  Used by the vault Lock/Encryption cluster (bucket 3) and future compliance UI.
- `src/components/ds/Kbd.tsx` — `<Kbd>⌘K</Kbd>` chip via `.kbd`.
- `src/components/ds/RegistryMotif.tsx` — the signature illustration: Lucide
  `Layers` at 24px `--fg-subtle`, 1.5px stroke, optical container ~64px, with an
  optional bottom-right overlay glyph prop (`lock|file-text|file-search|layers|
  scroll-text|gavel|share-2`). `aria-hidden`. Never animates.
- `src/components/ds/SkeletonRow.tsx` — table skeleton row mirroring the vault
  column widths; `.skeleton` shimmer, static under reduced-motion. (Bucket 3 may
  import it, or keep its own `GridSkeleton`; expose it so both align.)

Rewrite `src/components/EmptyState.tsx` to the `ui-empty-states.md` §1 anatomy:
- Props: `{ title, body?, illustration?: overlay-glyph, primary?, secondary?,
  hint?, role?: "status"|"alert", tone?: "calm"|"alarm" }`. Backward-compat:
  keep accepting the current `{title, subtitle, cta, icon}` call sites (map
  `subtitle→body`, `cta→primary`) so `Shell.tsx`/`Files.tsx`/`Notes` don't break
  before bucket 3 updates its calls. Default illustration = `RegistryMotif`.
- Layout: centered, `max-width:420px`, 16px stack gap, top padding ≤ `--space-8`
  (32px), no card/shadow, fade-in `--dur-base` opacity-only. Title `--text-lg/600
  --fg-default`; body `--text-sm/500 --fg-muted`; one amber primary max; secondary
  ghost/link `--fg-muted`; hint `--fg-subtle` with `Kbd` chips.
- **Catalog entries to ship this milestone** (copy verbatim from
  `ui-empty-states.md`): §3.1 empty locker (`lock` overlay), §4 empty folder
  (`file-text`), §5 no-search-results (`file-search`), §10 first-run
  (`layers`, no overlay, orientation strip). Wire the vault-empty/first-run copy
  in `Files.tsx` (bucket 3) via this component; wire cmdk no-results (bucket 2).
  Other catalog entries (versions/audit/holds/shares/tamper) are later milestones.

---

## Wiring to existing auth/state/api (no breakage)

- **Auth/Workspace/Presence:** untouched. Sidebar keeps `username` from
  `useAuth()`, vault keeps `useActiveWorkspaceId()`/`searchAdvanced`. No provider
  changes.
- **Routing:** `App.tsx` `Router()`, `Shell.tsx` `nav` state, `/file/<id>`,
  `/s/<token>`, `/invite/<token>` all unchanged. We only restyle.
- **Events:** keep all `cd:*` CustomEvents (`cd:nav`, `cd:open-file`,
  `cd:open-note`, `cd:search-query`, `cd:search-commit`, `cd:apply-filters`,
  `cd:recents-changed`) and `⌘K`/`?` keydown handlers verbatim.
- **API:** no endpoint added/changed. Vault reads `version`/`status` fields that
  already exist on `FileDto`.
- **Build gate:** each bucket runs `pnpm typecheck` before handoff; integrator runs
  `pnpm build`. TypeScript strictness means prop-contract changes (EmptyState,
  StatusChip) must land with their consumers or with back-compat shims (specified
  above).

---

## Four disjoint implementer buckets (no file collisions)

| Bucket | Owns (writes) | Reads/contracts | Deliverable |
|---|---|---|---|
| **1 — Tokens + global CSS** | `src/styles/tokens.css`, `src/main.tsx`, `package.json` (add `@fontsource-variable/inter`, `@fontsource/jetbrains-mono`) | design docs §2–§6 | Full Doc-Hub token set (values repointed under existing names + new tokens), type scale, dark mirror, `@theme` bridge, utilities (`.tnum .mono .caps-label .skeleton .kbd .hairline`), font swap. Build green with fallbacks. |
| **2 — App shell** | `src/components/Sidebar.tsx`, `src/components/TopBar.tsx`, `src/components/CommandPalette.tsx`, `src/pages/Shell.tsx`, `src/App.tsx` | tokens (b1), `EmptyState`+`Kbd` (b4) | 240px dense rail w/ encryption footer chip, amber active rule, 48px top bar, retokenized `⌘K` palette, restyled Toaster, tightened Shell padding. Logic untouched. |
| **3 — Vault list** | `src/pages/Files.tsx`, `src/components/FileRow.tsx` | tokens (b1), `StatusChip`+`SkeletonRow`+`EmptyState` (b4) | Dense table: Name/Kind/Version/Updated/Lock/Encryption header + rows, states, skeleton, empty-state wiring, media-preview stripped. Fetch/search/select logic untouched. |
| **4 — Empty states + primitives** | `src/components/EmptyState.tsx`, new `src/components/ds/StatusChip.tsx`, `src/components/ds/Kbd.tsx`, `src/components/ds/RegistryMotif.tsx`, `src/components/ds/SkeletonRow.tsx` | tokens (b1) | Registry-motif `EmptyState` (back-compat props) + shared DS primitives consumed by b2/b3. Catalog copy §3.1/§4/§5/§10. |

**Cross-bucket contracts frozen up front** (so buckets run in parallel):
- `EmptyState` accepts BOTH the legacy `{title,subtitle,cta,icon}` and the new
  `{title,body,illustration,primary,secondary,hint,role,tone}` props.
- `StatusChip({icon, label, tone?, title?})`, `Kbd({children})`,
  `RegistryMotif({overlay?, size?})`, `SkeletonRow({columns?})`.
- All new tokens named exactly as in `ui-system.md` §2.5/§3/§5; existing token
  names keep working (values repointed).

**Sequencing:** bucket 1 lands first (or stubs the token names) so 2–4 compile
against real values; 4 lands before 2/3 consume its primitives, or 2/3 use the
back-compat `EmptyState` path until 4 lands. Integrator runs `pnpm build` after
each merge.

## Definition of done (M1)

- `pnpm build` green (`tsc --noEmit && vite build`).
- Zero cyan/slate pixels on shell + vault; amber only for accent/status, amber
  text is `#8F5F17`. Rows ≤ 32px, sidebar 240px, top bar 48px.
- Sidebar shows the always-on encryption footer chip.
- Vault renders Name/Kind/Version/Updated/Lock/Encryption with a 36px header,
  hover/selected/focus/skeleton states; no media-preview affordance.
- List-empty, folder-empty, no-results, and first-run empty states use the
  registry motif; no fabricated data anywhere.
- Auth/routing/state/events unchanged; existing e2e paths still function.
</content>
</invoke>
