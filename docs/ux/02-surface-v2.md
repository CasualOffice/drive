# 02 — Surface spec (v2)

Supersedes the relevant sections of [`02-surface.md`](./02-surface.md) for the SPA rebuild. Authoritative source for what each surface looks like in Doc-Hub.

**Inputs synthesized:**
- [`ui-research/01-reference-spas.md`](../ui-research/01-reference-spas.md) — Linear/Vercel/Stripe/Notion/Figma/1Password patterns (registry/records-shaped, not file-manager-shaped)
- [`ui-research/02-stack-pick.md`](../ui-research/02-stack-pick.md) — Radix + shadcn/ui + Motion + auto-animate + vaul + sonner + cmdk + react-hook-form + zod
- [`ui-research/03-sign-in-patterns.md`](../ui-research/03-sign-in-patterns.md) — sign-in field strategy + error UX + a11y
- [`research/04-polish-principles.md`](../research/04-polish-principles.md) — the 10 commandments stay in force

Doc-Hub is a **document registry**: projects → documents, each with a permanent hash-chained version history, encrypted at rest, editable in embedded native editors, searchable by content. Not a Finder/Drive — no thumbnails, no media, no gallery.

## 1 — Identity

| Token | v1 (old) | v2 (new) |
|---|---|---|
| `--bg-canvas` | `#FAFAFA` cool grey | `#F2F0EA` warm paper |
| `--bg-default` (card) | `#FFFFFF` | `#FBFAF6` warm card |
| `--fg-default` (ink) | `#18181B` | `#1A1A1E` |
| `--fg-muted` | `#52525B` | `#3A3A42` (`ink-soft`); `#8A8A92` muted; `#A6A6AD` muted-2 |
| Accent | `#0A84FF` macOS blue | `#C8A45C` warm gold |
| Font (sans) | Inter only | **Hanken Grotesk** (body) |
| Font (display) | Inter Display | **Fraunces** (variable serif — headings, brand, typographic numerals) |
| Motion ease | `cubic-bezier(0.32, 0.72, 0, 1)` | `cubic-bezier(.2, .8, .2, 1)` |
| Focus ring | blue glow | `outline: 2px solid var(--ink); outline-offset: 2px; border-radius: 6px` |
| Card radius | `8px` | `18px` (`--radius`) |
| Shadow | flat scale | `--shadow: 0 1px 2px /.04, 0 8px 30px /.05` + `--shadow-hover: 0 2px 4px /.06, 0 16px 44px /.10` |

**Why the palette:** warm paper + gold gives Doc-Hub an editorial, records-office personality — a document registry, not another macOS-blue SaaS dashboard. It reads "archive you can trust", which is the brand.

## 2 — Stack (locked)

| Layer | Pick | Why |
|---|---|---|
| Component primitives | **Radix Primitives** (`radix-ui` 1.4.x) | Accessible, keyboard-first |
| Visual layer | **shadcn/ui** (CLI v4, Tailwind v4 + React 19) | Code lives in our repo, edited to the 10 commandments |
| Motion (general) | **Motion** (`motion` 12.x) `LazyMotion(domAnimation)` | layout/spring/gesture/exit |
| Motion (list reorder) | **`@formkit/auto-animate`** | version-list + document-list reorder |
| Toasts | **sonner** 2.x | ink/gold style |
| Drawers | **vaul** 1.1.x | mobile sidebar, selection bar |
| Command palette | **cmdk** 1.1.x | content search + commands |
| Forms | **react-hook-form** 7.x + **zod** 4.x | sign-in, settings, share options |
| Icons | **lucide-react** | inviolable rule — SVG only |
| Type | **Fraunces** + **Hanken Grotesk** variable, self-hosted | no Google Fonts hop |

## 3 — Doc-Hub-tailoring (what the registry model requires)

- **Sidebar is projects, not "My Drive".** Top-level nav is **Projects** (Personal locker + team projects) and **System** (Activity, Trash, Settings). No "Shared/Starred" cloud-storage chrome.
- **Storage card → Encryption + storage status.** The sidebar-bottom card states **"Encrypted at rest"** (always true — boot requires a key) with the backend in use and used bytes from config (`DOCHUB_STORAGE_QUOTA_GB` when set → "122 GB of 200 GB used"; unset → "122 GB used"). No "Upgrade plan", no upsell.
- **List columns: Name · Modified · Size · Type · Version.** The **Version** column (head `vN`) is load-bearing — it's the registry. No Owner column in v0 (restore with multi-user); no thumbnail column ever.
- **No media anywhere.** No procedural image/video/audio thumbnails, no gallery view, no preview of raster/media. Documents only.
- **Document tiles/rows are type-glyph + name + version + badges** (legal-hold lock, provenance-verified, editing). Procedural "thumbnails" are demoted to a small type-tinted **document glyph** (paper/sheet-grid/pdf-header/markdown mark), not a content render.
- **Primary action is embedded-editor open**, type-aware:
  - `.xlsx` / `.csv` → **"Open in Casual Sheet"** (embedded)
  - `.docx` → **"Open in Casual Docs"** (embedded)
  - `.pdf` → **"Open in Casual PDF"** (embedded)
  - `.md` / `.txt` / `.json` / `.yaml` → **"Open"** (embedded markdown/text editor)
  - Opaque (`.xlsm`, `.pptx` until Slides) → **"Download"**
  - **Download** always present as a secondary action; **View history** always present.
- **All owner-shaped sample data shows "You"** in v0.

## 4 — Surfaces

### Sign-in (replaces §13)

- 360 px centred card, `--bg-default`, `--shadow-md`, hairline, `--radius-xl`.
- Logo (28 px `shield` mark `--accent`) → Fraunces wordmark "Doc-Hub" → Hanken subtitle "Sign in to continue."
- **Username + password** inputs. **Sign in with SSO** (OIDC Auth Code + PKCE) shown only when an IdP is configured.
- Submit full-width, ink-filled, paper text, disabled until both fields non-empty.
- Error inline `--danger` + 1 px tint + single shake (8 px, 280 ms). Caps-lock helper.
- Microcopy: title "Doc-Hub", subtitle "Sign in to continue.", error "Wrong username or password.", lockout "Too many attempts. Try again in 10 minutes."
- No forgot-password, no sign-up in v0. Solid `--bg-canvas` background.

### First-run wizard

Not a sign-in — see [`04-setup-wizard.md`](./04-setup-wizard.md). Admin creation + master-key confirmation are required before any sign-in card renders.

### Sidebar (replaces §2)

| Region | Spec |
|---|---|
| **Brand row** | 48 px, `shield` logo + Fraunces "Casual" over letter-spaced "VAULT". |
| **"New" button** | Full-width ink-filled, `--radius` 14 px. Dropdown: **New project** / **Upload documents** / **New folder**. |
| **Nav (Projects)** | Section label "PROJECTS" (10 px uppercase muted-2). Rows: **Personal** (locker, `lock` glyph, never deletable) + each team project, with disclosure chevrons for top-level folders. Active row = ink-filled, paper text, 2 px accent left stripe. |
| **Nav (System)** | Section label "SYSTEM". Items: **Activity**, **Trash** (tombstone count when non-empty), **Settings**. |
| **Encryption / storage card (pinned bottom, above avatar)** | `--card` bg, `--radius` 18 px, `--line` border. Title "Encrypted at rest" (13 px) + `shield-check` `--success`. Subtitle: backend + "122 GB of 200 GB used" (quota set) or "122 GB used". No "Upgrade plan". |
| **Avatar (pinned bottom)** | 40 px monogram, opens Radix menu (Account / Settings / Sign out `⇧⌘Q`). |

Width 248 px. Right border `--line`.

### Top bar (replaces §3)

48 px. Layout: **content-search trigger** (left, opens cmdk palette — searches *inside* documents), **(no view toggle — list only)**, no top-bar avatar. Placeholder "Search inside your documents…".

### Document-browser pane (replaces §4 + §5 + §7)

- **Head:** optional **Back** (34 px, when not at project root), **breadcrumbs** (project › folders, Fraunces 13 px muted, chevron separators), **Title row** (`<h1>` Fraunces 30 px + count "12 documents"), **Sort dropdown** (Name / Last modified / Size / Version; folders pinned first).
- **Section-head pattern:** Fraunces 15 px muted ("All documents") + flex-1 hairline rule.
- **Stage:** animates on folder change (`swap` keyframe, opacity + translateY 8→0, 420 ms).
- **List view (the only view):** card with hairline-separated 32 px rows. Columns: Name (16 px document type-glyph + 13.5 px label) · Modified · Size · Type · **Version (`vN`)**. Badges after the name: legal-hold `lock`, provenance `shield-check`, `Editing`. Hover: 3% ink overlay, reveals row overflow + **Ask** (when AI enabled).
- **Document glyph** (no thumbnail): a small type-tinted mark — paper for doc, grid for sheet, red-header bar for PDF, `#` for markdown, braces for json/yaml, table for csv, folder glyph for folder. Never a content render, never media.
- **Empty state:** centred column, 96 px illustration (icon + plus, paper bg, muted-2 stroke), Fraunces 18 px title, Hanken 13.5 px subtitle.
  - No projects: "Create your first project." / "Projects hold your documents."
  - Empty project: "This project has no documents yet." / "Upload documents or create one."
  - Empty folder: "This folder is empty." / "Drop documents here."
  - Empty search: "No documents match \"<q>\"." / "Search reads inside documents, not just names."

### Document detail / history panel (replaces §10.3 preview modal)

The v1 "Preview modal" is recast as a **Document detail + version-history** surface. It never renders media.

- Radix Dialog or right-edge drawer. Backdrop `rgba(26,26,30,0.42)` + 6 px blur.
- Two regions: **detail** (name, type, size, current `vN`, provenance/hold badges, project/folder location) + **version history** list (newest-first: `seq`, author, time, size, `content_hash` prefix, **View** / **Diff** / **Restore**).
- **Action row:** primary (type-aware embedded-editor open, see §3), **View history**, **Share** ([`05-sharing-surface.md`](./05-sharing-surface.md)), **Verify** (when provenance-signed). Secondary always: **Download**.
- **Chain-verified** `shield-check` header badge; **tamper** banner (`--danger`) with "Chain verification failed at vK." when `verify_chain` fails — restore disabled until an admin acknowledges.
- Keyboard: Esc close, `H` history, `D` diff-select, `R` restore.
- Full behaviour in [`07-preview-surface.md`](./07-preview-surface.md) (document read-only preview) + `02-surface.md` §9 (history panel).

### Toasts (replaces §11)

- sonner, bottom-center stack. Ink bg, paper text, gold check on success.
- Used for: upload completion ("Uploaded N documents."), save ("Saved as vN."), restore ("Restored v2 as v6."), move/trash, link copied, sign-out-for-security, ingest rejection ("N documents were rejected.").
- Lifetime: 4 s default, 8 s with Undo.

## 5 — Motion budget (consolidated)

| Element | Property | Duration | Curve |
|---|---|---|---|
| Buttons / nav rows hover | bg | 180 ms | `--ease` |
| Buttons press (filled) | translateY(-1px) | 200 ms | `--ease` |
| Rows hover | bg overlay | 180 ms | `--ease` |
| Stage swap (folder/project nav, search) | opacity + translateY(8→0) | 420 ms | `--ease` |
| Dropdown open | opacity + translateY(-6→0) | 200 ms | `--ease` |
| Detail/history panel open | opacity + translateX(16→0) | 280 ms | `--ease` |
| Toast in/out | opacity + translateY(12) | 300 ms | `--ease` |
| Version-list reorder (new version prepends) | auto-animate FLIP | 200 ms | `--ease` |
| Sign-in shake | translateX 0/-6/6/0 | 280 ms | `--ease` |
| Reveal sections on mount | opacity + translateY(10→0) | 600 ms | `--ease` |

`prefers-reduced-motion` → all collapse to ≤50 ms opacity-only.

## 6 — What stays from the v1 spec

§2 keyboard model (arrows / Enter / Backspace-as-tombstone / F2 / Cmd-A / Esc / letter-jump, plus `H` history). §7 selection bar. §8 command palette (now content search + Ask). §12 drop zones + inline ingest row (documents-only, rejects others). §14 recipient share page (documents only). §15 editor + provenance affordances (embedded editors primary; version badge; provenance badge; encryption is ambient, not per-document).
