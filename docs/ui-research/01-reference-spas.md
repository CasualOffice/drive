# 01 — Reference SPAs: What Makes a Professional Document-Doc-Hub UI Feel Premium in 2026

**Audience:** the engineer building Doc-Hub's SPA (React 19 + Vite 7 + Tailwind v4 + TS).
**Purpose:** harvest concrete, copy-able patterns from nine best-in-class registry / list / hub apps. Builds on `docs/research/04-polish-principles.md` — this brief is the *reference set* those rules pointed at.
**Bar:** Linear / Things 3 / Raycast. Doc-Hub is a professional **document registry and hub** — an authoritative, versioned, auditable record — **not** a Drive/Dropbox clone. No thumbnails, no media grids, no consumer file-manager chrome.
**Scope:** visible-craft and interaction-craft. Performance architecture noted only where it shapes the UI.

---

## TL;DR

- The new monoculture: **near-monochrome canvas, single accent, hairline borders instead of shadows, ~32 px rows, 13 px text.** Linear, Vercel, Stripe, GitHub, 1Password converge on the same grammar.
- **13 px is the new 14 px** for dense rows. 14–15 px is body. Display-cut faces (Inter Display, Geist, Söhne, SF Pro Display) carry headings with negative tracking.
- **Sidebar dimmer than canvas, content brighter than sidebar.** Linear's 2024 refresh — the single most reproducible cross-app pattern.
- **One accent does all the work** — `selected` / `primary CTA` / `focus ring` and nowhere else. Linear purple, Vercel near-black, Stripe `#533afd`, 1Password blue.
- **Hairlines (#ebebeb) replace shadows for in-plane separation.** Shadows reserved for elevation only.
- **Mono for identity data.** Vercel and GitHub set IDs, hashes, and commit SHAs in mono — the typeface signals "this is a verifiable value". The hub does the same for `content_hash`, version, and provenance columns.
- **Immutable-record UIs read as trust.** GitHub's commit/diff/blame and Vercel's immutable deployment list are the reference for the hub's version chain: linear, append-only, each entry addressable by hash.
- **Optimistic UI is non-negotiable** for *reversible* actions (rename, move, star). It is **not** applied to commits — a saved version is a durable, audited fact, shown only once the server confirms.
- **`cmdk` (Paco Coursey) is the de facto Cmd-K component** — Linear, Vercel, Raycast, Sourcegraph all run on it.
- **Doc-Hub should ship:** Linear-density rows (32 px / 13 px), Geist tokens (`#fafafa` / `#171717` / `#ebebeb`), Stripe-style tables (no zebra, hover-only), GitHub-style version/hash columns in mono, 1Password's three-pane hub shell, Raycast search-as-you-type.

---

## 1. Linear — Polish Benchmark

**Surfaces:** issues list, sign-in, command palette, settings, Inbox / Triage.

**Polish hooks:**
- **Sidebar dimmer than canvas.** The 2024 refresh "made the navigation sidebar dimmer in the updated interface, allowing the main content area to take precedence" ([part II](https://linear.app/now/how-we-redesigned-the-linear-ui)). The 2026 refresh kept pushing — "less visual noise, clearer structure, calmer UI" ([UI refresh changelog](https://linear.app/changelog/2026-03-12-ui-refresh)).
- **~32 px rows / 13 px text / 24 px line-box.** ([linear.app tokens, FontOfWeb](https://fontofweb.com/tokens/linear.app))
- **Compact tabs** with rounded corners and smaller icons; **reduced icon usage** with colored team-icon backgrounds removed ([part II](https://linear.app/now/how-we-redesigned-the-linear-ui)).
- **Warm grey shift.** "Old palette was cool, blue-ish; aim was to inch toward a warmer gray that still feels crisp" ([calmer interface](https://linear.app/now/behind-the-latest-design-refresh)).
- **Optimistic UI by architecture.** IndexedDB → MobX in-memory pool → synchronous re-render → background WebSocket sync ([performance.dev](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown), [Vinta](https://www.vintasoftware.com/lessons-learned/hows-linear-so-fast-a-technical-breakdown)). Speed is a design decision.
- **Keyboard discoverability.** Every hover-able action shows its shortcut in a tooltip ([925studios breakdown](https://www.925studios.co/blog/linear-design-breakdown-saas-ui-2026)).

**Steal:** sidebar one notch dimmer than canvas; 32 px row × 13 px text × tabular nums; tooltip + mono shortcut chip on every action; optimistic write path for rename/move/star from v1 (not for commits); warm zinc not blue slate.

**Anti-pattern:** density without consistent row rhythm reads cluttered — Linear's pre-2024 lesson.

---

## 2. Vercel Dashboard — Immutable Records, Tailwind-Dense

**Surfaces:** projects list, **deployments list (immutable, hash-addressed)**, team switcher, sign-in. New dashboard default since early 2026 ([rollout](https://vercel.com/changelog/dashboard-navigation-redesign-rollout)).

**Polish hooks:**
- **Near-monochrome.** Off-white canvas `#fafafa`, near-black text/fill `#171717` (never pure `#000`), hairline border `#ebebeb` ([SeedFlip Geist breakdown](https://seedflip.co/blog/vercel-design-system), [Geist colors](https://vercel.com/geist/colors)).
- **The deployments list is an append-only ledger.** Each row is an immutable deployment keyed by a short commit SHA, with author, timestamp, and status — never edited in place, only superseded. This is the closest mainstream analog to the hub's version chain. May 27 2026 went **denser** and grouped by status ([deployments redesign](https://vercel.com/changelog/redesigned-deployments-list)).
- **Hairlines, not shadows.** `#ebebeb` is the default border for cards, nav, inputs, dividers ([SeedFlip](https://seedflip.co/blog/vercel-design-system)).
- **Geist Sans + Geist Mono.** Type scale `12 / 14 / 16 / 18 / 24 / 32 / 48 / 64`. Letter-spacing `-0.02em` at body scaling to `-0.06em` at display ([Geist typography](https://vercel.com/geist/typography)).
- **Mono everywhere it's data** — IDs, hashes, SHAs, env vars. The typeface signals "this is a verifiable value".
- **Rauno-level micro-craft.** Staff Design Engineer Rauno Freiberg documents the philosophy on [rauno.me/craft](https://rauno.me/craft) and [interfaces.rauno.me](https://interfaces.rauno.me/): "if a UI only works 80% of the time, the perception of quality breaks" ([Invisible Details](https://rauno.me/craft/interaction-design)).

**Steal:** Doc-Hub canvas `#fafafa`, text `#171717`, border `#ebebeb` — adopt verbatim. Mono for the `content_hash` (short form), version, and any ID/provenance column. Model the version-history timeline on the deployments ledger: append-only, hash-addressed, status-badged. Adopt `interfaces.rauno.me` as PR-review criteria.

**Anti-pattern:** pure `#000` on pure `#fff` reads cheap. Never ship `text-black bg-white`.

---

## 3. Stripe Dashboard — Data-Table + Audit-Log Done Right

**Surfaces:** payments table, customers list, **event / audit-log detail drawer**, sign-in. Built on Stripe's internal **Sail** system ([Sail by Chase McCoy](https://portfolio.chsmc.org/sail), [Stripe UI components](https://docs.stripe.com/stripe-apps/components)).

**Polish hooks:**
- **Single typeface: Söhne.** Weight 300 for display headings, -0.03em tracking at 56 px ([Stripe Refero breakdown](https://styles.refero.design/style/48e5de76-05d5-4c4e-a269-c7c245b291ec)).
- **Deep Violet `#533afd` primary, Vibrant Orange `#ff6118` focus accent.** One CTA color, one focus color. Card surfaces with soft 6 px rounded corners.
- **No zebra; hover-only highlight** ([NN/g data tables](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables), [zebra vs hover](https://medium.com/@designbyfgs/do-zebra-striping-practices-in-table-ui-design-enhance-readability-or-create-visual-noise-5d98cc59f4fd)).
- **Row click → right drawer**, never full-page nav. Keeps table context anchored. The event/log detail is a read-only record — exactly the shape of the hub's document-detail + provenance drawer. `[unverified specifics]` from live dashboard.
- **8 px `elementGap`** for related controls (search + filter + segmented).
- **Sign-in: WebAuthn / passkeys first.** Magic-link verification in the background, no retype ([Eleken sign-up flows 2026](https://www.eleken.co/blog-posts/sign-up-flow)).

**Steal:** no zebra, hover-only highlight, no row dividers between groups, hairline below header. Row-click → right-drawer for document detail (metadata + version chain + audit). Single accent. Sign-in: passkey-first (Phase 3), password now.

**Anti-pattern:** Stripe's payments table shows 10+ columns by default → horizontal scroll. Doc-Hub: 5–6 columns max (name, version, updated, kind, encryption, lock), rest in detail drawer.

---

## 4. Notion — Sidebar & Share-Modal Chrome

**Surfaces:** sidebar, page hierarchy, permission/share modal. *(Referenced for chrome and sharing, not its block editor — the hub edits documents in embedded native editors, not Notion blocks.)*

**Polish hooks:**
- **NotionInter everywhere.** 16 px body @ 400; 20 px+ headings @ 500/600; 14 px captions ([DesignMD Notion benchmark](https://designmd.cc/benchmarks/notion)).
- **Strict 4 px scale: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.** No magic numbers ([DesignMD](https://designmd.cc/benchmarks/notion)).
- **Warm greys.** "Warm grays replace harsh blacks, keeping the reading experience soft" ([sidebar breakdown](https://medium.com/@quickmasum/ui-breakdown-of-notions-sidebar-2121364ec78d)).
- **Sidebar icons in fixed 22 px columns.** Hierarchy carried by indentation alone — not by icon size or weight.
- **Disclosure/drag handles appear on hover only**, never persistent. Removes 90% of chrome at rest.
- **One primary button: `#097fe8`, 4 px radius, white text.** Everywhere.
- **Share modal:** single column, permission row per recipient (dropdown), copy-link footer. No tabs ([Notion sharing](https://www.notion.com/help/sharing-and-permissions)).

**Steal:** enforce the 4 px spacing scale in lint. Disclosure chevrons on row-hover only. Share modal layout copy-pasted: single column, permission rows, expiry + password on the hub's share (it's a share-*link* with a token, per the two-origin model), copy-link footer. Sidebar (Projects) icons in a fixed 22 px column.

**Anti-pattern:** Notion's web app historically had slow page transitions. Doc-Hub: every nav < 100 ms (optimistic).

---

## 5. GitHub — Version History, Hash Chain, Provenance

**Surfaces:** commit history, commit/diff view, blame, PR "Files changed", verified-signature badge. *(The single closest reference for the hub's core: an append-only, hash-linked, signed record you can diff and verify.)*

**Polish hooks:**
- **Commit list is the version chain.** A linear, reverse-chronological list of immutable commits, each with a short **mono SHA**, author avatar, message, and relative time ([viewing commit history](https://docs.github.com/en/desktop/managing-commits/viewing-the-branch-history-in-github-desktop)) `[unverified visual specifics]`. This is exactly the hub's per-document version timeline: `seq`, short `content_hash`, author, reason, `created_at`.
- **Diff view: two-column or unified, hairline gutters, mono body, additions/removals in low-saturation green/red tints** — not loud. The hub diffs document versions in the same restrained palette.
- **Verified badge on signed commits.** A small "Verified" chip surfaces cryptographic provenance without shouting ([about commit signature verification](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification)). The hub surfaces Ed25519 provenance the same way: a quiet "Signed" / "Verified" chip on a version, expandable to signer + hash.
- **Blame ties a line to a commit** — provenance at the finest grain. The hub's equivalent is "which version introduced this" on a document.
- **Mono for every identity value.** SHAs, tags, blob IDs. Signals verifiability.

**Steal:** version timeline = GitHub commit list (short mono `content_hash`, author, reason, relative time; click → version detail). "Verified" / "Signed" provenance chip, quiet by default, expandable to signer + full hash. Diff two versions with low-saturation add/remove tints and mono gutters. A saved version is **never** optimistic — it appears only after the server confirms the append, because it's a durable audited fact.

**Anti-pattern:** GitHub's chrome is dense to the point of noise on some pages (checks, labels, sidebars stacking). Doc-Hub: one record, one chain, one detail drawer — resist stacking meta-panels.

---

## 6. Dropbox Web — The Consumer File-Manager to *Not* Copy

**Surfaces:** file browser, action bar, share modal. *(Kept as a contrast reference: it is the Drive-clone the hub deliberately is not. One pattern is worth stealing; the rest is what to avoid.)*

**Polish hooks (the one to steal):**
- **Selection-aware action bar.** Empty selection → "Upload / New folder"; selected item → context actions ([GoodUX redesign intro](https://goodux.appcues.com/blog/dropbox-redesign)). The morph-on-selection pattern is correct and the hub adopts it.
- **Expandable folder tree in left nav** ([TechSpot on Dropbox redesign](https://www.techspot.com/news/100467-dropbox-rolls-out-redesigned-web-interface-releases-new.html)). Fine as a sidebar spine.

**Steal:** action bar morphs on selection. Expandable Projects/folders tree as the sidebar spine; preserve disclosure state across nav.

**Anti-patterns (most of it):**
- **Thumbnails and inline media previews.** The hub is documents-only and encrypted-at-rest; it renders **type glyphs + metadata**, never generated thumbnails, and opens content in the embedded editor or the sandboxed user-content origin — never inline in the app chrome.
- **44 px+ consumer rows.** Too loose. Doc-Hub sits at Linear's 32 px.
- **Promotional banners** ("Try Dash!", "Upgrade") in the chrome. Doc-Hub: zero in-product upsells.
- **"Put anything here" storage framing.** The hub is a registry of specific document types, not a dumping ground.

---

## 7. Arc Browser — Polish by Restraint

**Surfaces:** sidebar, Command Bar (`Cmd-T`), Little Arc, Spaces.

**Polish hooks:**
- **Vertical sidebar replacing horizontal tabs.** "Horizontal space is premium; vertical space is abundant" ([Blake Crosley](https://blakecrosley.com/guides/design/arc), [Refine on Arc](https://refine.dev/blog/arc-browser/)).
- **Command Bar as the only address-bar.** `Cmd-T` opens universal search across tabs/history/bookmarks/actions ([Wikipedia](https://en.wikipedia.org/wiki/Arc_(web_browser))).
- **Little Arc:** stripped, chromeless quick-lookup window. Same product, two intensities.
- **Animation discipline.** Most chrome transitions 200 ms; sidebar fade sub-100 ms; hover/press instant. Polish by *not* animating most things.

**Steal:** `Cmd-K` as universal entry (use [cmdk by Paco Coursey](https://cmdk.paco.me/)). Optional "compact mode" — hide sidebar + detail, full-screen list. Sidebar ~240 px expanded / 52 px collapsed, persistent per-user.

**Anti-pattern:** Josh Miller admitted Arc was "too different… for too little reward" ([TechCrunch on Dia](https://techcrunch.com/2025/11/03/dias-ai-browser-starts-adding-arcs-greatest-hits-to-its-feature-set/)). Polish must not require re-learning canonical patterns.

---

## 8. Raycast — Cmd-K as the Whole App

**Surfaces:** root list, extension store, search bar as primary surface.

**Polish hooks:**
- **Search-as-you-type is primary.** Search bar focused on open; fuzzy filter client-side ([Raycast List docs](https://developers.raycast.com/api-reference/user-interface/list)). Maps directly to the hub's headline feature: **content search** — the search bar queries *inside* documents, not just names.
- **Single-line rows.** Icon (16/20 px) + title + dimmed right-aligned subtitle + accessory. ~32 px row matches Linear.
- **Action panel (`Cmd-K`) per item.** `Enter` for primary; `Cmd-K` shows *all* actions for the highlighted item, each shortcut-labelled.
- **No empty state on root** — show recents instead.

**Steal:** document rows behave like Raycast list items — `Enter` opens, `Cmd-K` reveals all actions (Open, History, Share, Download, Move to trash). Pre-focus global content-search on dashboard load. Title left, metadata mono right. Recents-as-first-screen — never show "0 documents" pane.

**Anti-pattern:** Raycast is keyboard-only on native macOS. On web, keep hover states, right-click menus, kebab on each row. Keyboard is *parallel*, never *required*.

---

## 9. 1Password 8 — The Doc-Hub Reference

**Surfaces:** sign-in, hub list, item detail. *(The most direct product analog: an encrypted hub of sensitive records with a three-pane shell — Doc-Hub is the document equivalent.)*

**Polish hooks:**
- **Knox design language** across web / mobile / desktop ([Knox case study by Alice Liao](https://aliceliao.com/work/knox)).
- **Three-pane layout:** sidebar (vaults / categories) → list (items in scope) → detail (selected). The hub's shell one-for-one: Projects → document list → detail drawer (metadata, version chain, audit, provenance).
- **Semantic color tokens.** "A semantic token carries a role rather than a value — `color-surface-base`, `color-text-primary`" ([Muz.li on dark-mode systems](https://muz.li/blog/dark-mode-design-systems-a-complete-guide-to-patterns-tokens-and-hierarchy/)).
- **Security state is legible, not decorative.** Lock/unlock, item categories, and integrity cues are quiet system chrome. The hub surfaces encryption + lock + hold status the same way: small, semantic, never alarmist.
- **Sign-in chunked:** one decision per screen, WebAuthn-forward.

**Steal:** three-pane shell as the hub default — sidebar / list / right detail drawer (closed by default, opens on row-click or `Cmd-I`). Semantic CSS variables; never raw hexes in components. Encryption/lock/hold shown as quiet semantic chips. Sign-in chunked, WebAuthn-forward in Phase 3.

**Anti-pattern:** 1P8 cut list density to ~75% of 1P7 and got publicly punished — "reduced the amount of information visible without scrolling" ([1P community](https://1password.community/discussion/122677/item-list-information-density-in-1pw8)). Doc-Hub: land on Linear's 32 px density, not 1P8's 40+.

---

## Synthesis — The Converged Grammar

Patterns appearing in 6+ of 9 references — safe defaults for a premium 2026 registry/hub SPA.

### Type rhythm

| Role | Size | Weight | Tracking | Used in |
|---|---|---|---|---|
| Page title | 20–24 px | 600 | -0.02 em | Linear, Vercel, Notion |
| Section title | 15–17 px | 600 | -0.01 em | All |
| Body | 14–15 px | 400 | 0 | Vercel, Stripe, Notion |
| **Dense list row** | **13 px** | **400** | **0** | **Linear, Raycast, Vercel** |
| Metadata / caption | 11–12 px | 400–500 | +0.005 em on UPPERCASE | All |
| Mono (hash / version / ID) | 12–13 px | 400 | 0 | Vercel, GitHub, Linear |

**Weight contrast:** 400 body / 500 emphasis / 600 headings. Bold (700) reserved for marketing. Max three weights per screen.

### Spacing rhythm

Notion published the canonical scale: **4, 8, 12, 16, 20, 24, 32, 40, 48, 64** ([DesignMD](https://designmd.cc/benchmarks/notion)). Linear / Vercel / Stripe ship from the same set. Doc-Hub's tokens already match — enforce in lint.

Inside a row: 8 px icon→label, 12 px label→metadata. Inside a card: 16 / 24 px padding. Between sections: 24 / 32 / 48 px.

### Colour discipline

- **Canvas off-white, not pure white.** Vercel `#fafafa`.
- **Text near-black, never pure black.** `#171717` calibrated; `#000` exposes anti-aliasing.
- **Hairlines `#ebebeb` (light) / `rgba(255,255,255,0.08)` (dark)** replace shadows for in-plane separation.
- **One accent does all the work** — `selected`, `primary CTA`, `focus ring`.
- **Semantic tokens, never raw hexes** ([Muz.li dark mode](https://muz.li/blog/dark-mode-design-systems-a-complete-guide-to-patterns-tokens-and-hierarchy/)).
- **Status colours are muted and semantic** — encryption/lock/hold/verified chips read as system chrome, never as alerts.
- **Dark mode paired, not inverted** ([LogRocket on linear dark mode](https://blog.logrocket.com/how-do-you-implement-accessible-linear-design-across-light-and-dark-modes/)).

### Motion budget

- **Hover / press / focus: 80–120 ms** (sub-100 reads instant).
- **UI transitions: 150–250 ms.**
- **Full-screen: 400 ms max.**
- **Default curve `cubic-bezier(0.32, 0.72, 0, 1)`**; spring for direct manipulation.
- **Don't animate everything.** Rauno: "only animate when it clarifies cause & effect or adds deliberate delight" ([interfaces.rauno.me](https://interfaces.rauno.me/)). Right-click, kebab, and tooltips open instantly, close gently.

### Surface treatment

- **Hairlines do the work shadows used to.** Shadows reserved for elevation (popover / modal / drawer).
- **Shadows when used: soft, low-alpha, large blur.** `0 8px 24px /0.08` popover; `0 24px 60px /0.16` modal.
- **Vibrancy (`backdrop-blur`) on ≤1 surface per screen** ([NN/g glassmorphism](https://www.nngroup.com/articles/glassmorphism/)).

### Density

| App | Row height | Body | Notes |
|---|---|---|---|
| Linear | ~32 px | 13 px | The benchmark |
| Raycast | ~32 px | 13 px | Same, on native |
| Vercel | ~36 px | 14 px | Slightly looser |
| GitHub | ~34 px (commit rows) | 14 px | Record rows |
| Stripe | ~40 px (tables) | 14 px | Taller for click affordance |
| 1P8 | ~40 px | 14 px | Cautionary tale — too loose |
| Dropbox | ~44 px | 14 px | Consumer; too loose |

**Doc-Hub target: 32 px document rows / 13 px text.** Ship one density at v1 (Sonoma System Settings warning in `04-polish-principles.md` §12).

### Empty states

- **One muted line illustration + one sentence + one button** ([SaaSUI Linear empty state](https://www.saasui.design/pattern/empty-state/linear)).
- **Empty search ≠ empty project ≠ first-launch.** Each has own copy/CTA.
- **Raycast inversion:** no empty state on root — show recents.

### Focus rings

WCAG 2.4.13 requires ≥2 CSS px and ≥3:1 contrast ([AllAccessible WCAG 2.4.13](https://www.allaccessible.org/blog/wcag-2413-focus-appearance-guide)).

- **`box-shadow`, not `outline`** — outline ignores `border-radius` ([interfaces.rauno.me](https://interfaces.rauno.me/)).
- **`:focus-visible` only.**
- **Double-ring for contrast:** `0 0 0 2px var(--bg-canvas), 0 0 0 4px var(--accent)`.
- **Accent at ~60% opacity.**

---

## Patterns to Adopt Verbatim for Doc-Hub

PR-review checklist. Each item is a concrete spec.

### Layout
- [ ] **Three-pane shell (1Password):** sidebar (Projects, 240 / 52 px collapsed) — document list — right detail drawer (closed by default; opens on row-click or `Cmd-I`; shows metadata + version chain + audit + provenance).
- [ ] **Sidebar background one notch dimmer than canvas.**
- [ ] **Expandable Projects/folders tree** in sidebar; disclosure state persisted per-user.
- [ ] **Breadcrumb in list header mirrors sidebar position exactly.**

### Type
- [ ] Inter (web) / system-ui (Apple); Inter Display for headings ≥17 px.
- [ ] Scale `11 / 12 / 13 / 14 / 15 / 17 / 20 / 24 / 30`.
- [ ] **Tabular numerals** on every numeric column.
- [ ] Mono (JetBrains Mono or Geist Mono) for `content_hash`, version, size, ID, provenance.
- [ ] Weights 400 / 500 / 600 only.

### Density
- [ ] **Document row: 32 px high, 13 px text, 8 px icon→label, 12 px label→metadata.**
- [ ] Sidebar item: 28 px high, 13 px text.
- [ ] Ship one density at v1.

### Colour
- [ ] Canvas `#fafafa` light / `#0a0a0b` dark. Never pure `#fff` or `#000`.
- [ ] Text `#171717` light / `#f4f4f5` dark.
- [ ] Hairline `#ebebeb` light / `rgba(255,255,255,0.08)` dark.
- [ ] Single accent at `selected` / `primary CTA` / `focus ring` only.
- [ ] Muted semantic chips for encryption / lock / hold / verified.
- [ ] Paired dark scale, not invert.

### Borders & shadows
- [ ] Hairlines for in-plane separation; no shadows on resting cards.
- [ ] Shadow scale: `0 4px 12px /0.06` popover, `0 8px 24px /0.08` modal, `0 24px 60px /0.16` drawer.
- [ ] Vibrancy on ≤1 surface per screen.

### Motion
- [ ] Hover / press / focus 100 ms `cubic-bezier(0.32, 0.72, 0, 1)`.
- [ ] Popover / drawer 200 ms same curve.
- [ ] Page-level 300 ms max.
- [ ] `prefers-reduced-motion` honoured everywhere.
- [ ] Right-click / kebab / tooltips open instantly; close gently.

### Focus ring
- [ ] Double box-shadow: `0 0 0 2px var(--bg-canvas), 0 0 0 4px color-mix(in srgb, var(--accent) 60%, transparent)`.
- [ ] `:focus-visible` only.
- [ ] Never `outline: none` without a replacement.

### Hover treatment
- [ ] Row hover: 4–6% accent overlay (light) / 6–8% white overlay (dark). No border change. **No revealed thumbnails, no hover-checkbox** (the Drive-clone tells).
- [ ] Cursor: `pointer` for nav, `default` for buttons, `text` for editable.

### Tables / lists
- [ ] **No zebra.** Hover-only highlight.
- [ ] No row dividers inside a group; hairline below header; 16 px gap between groups.
- [ ] Selection: 10–18% accent overlay + 1 px left-edge accent rule.
- [ ] **Row click → right detail drawer.** Never full-page nav.
- [ ] **No thumbnails.** Type glyph + metadata columns (version / updated / kind / encryption / lock) — see `04-file-table.md`.

### Version / provenance (GitHub-derived)
- [ ] Version timeline = append-only commit-style list: short mono `content_hash`, author, reason, relative time.
- [ ] Diff two versions with low-saturation add/remove tints, mono gutters.
- [ ] "Signed" / "Verified" provenance chip, quiet, expandable to signer + full hash.
- [ ] A saved version is **not** optimistic — it appears only after the server confirms the append.

### Keyboard
- [ ] **`cmdk`-powered Cmd-K palette** as universal action surface (incl. content search).
- [ ] Every important action has a shortcut, advertised in tooltip with mono chip.
- [ ] Per-row `Cmd-K` action menu: `Enter` primary, `Cmd-K` all.
- [ ] Global content-search pre-focused on root.
- [ ] `Esc` always closes nearest dismissible surface.

### Optimistic UI
- [ ] Rename, move, star, create-folder optimistic (reversible).
- [ ] **Commit / restore / delete-under-retention are NOT optimistic** — durable, audited facts confirmed by the server first.
- [ ] Toast on optimistic success with undo (sonner): "Moved to Archive — Undo".
- [ ] Spinners only for ≥1 s finite tasks (uploads, exports, reindex).

### Empty states
- [ ] First-launch: muted line illustration + one sentence + one button.
- [ ] Empty project: small icon + "This project has no documents." + no button.
- [ ] Empty search: "No documents matched <query>." + Clear link.
- [ ] Root with recents: show last 10 used, never empty pane.

### Sign-in
- [ ] Password now; **passkey-first** and "Continue with <IdP>" (OIDC) added Phase 3.
- [ ] Multi-field auth chunked across screens (1P8 pattern): one decision per screen.
- [ ] Sign-in surface = same canvas + hairlines + accent as app. Continuity.

### Anti-clichés
- [ ] No gradient primary buttons.
- [ ] No pure-black-on-pure-white.
- [ ] No omnipresent glassmorphism (one blurred surface per screen max).
- [ ] No in-product upsells.
- [ ] No thumbnails, media grids, or hover-checkboxes (the consumer-Drive tells).
- [ ] No "Oops!" / "Whoops!"

---

## Sources

**Reference apps:**
- Linear — [UI refresh 2026](https://linear.app/changelog/2026-03-12-ui-refresh) · [new Linear 2024](https://linear.app/changelog/2024-03-20-new-linear-ui) · [redesigned Linear UI part II](https://linear.app/now/how-we-redesigned-the-linear-ui) · [calmer interface](https://linear.app/now/behind-the-latest-design-refresh) · [linear.app tokens (FontOfWeb)](https://fontofweb.com/tokens/linear.app) · [925studios breakdown](https://www.925studios.co/blog/linear-design-breakdown-saas-ui-2026) · [performance.dev](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown) · [Vinta](https://www.vintasoftware.com/lessons-learned/hows-linear-so-fast-a-technical-breakdown) · [SaaSUI empty state](https://www.saasui.design/pattern/empty-state/linear) · [Karri Saarinen on craft (Figma)](https://www.figma.com/blog/karri-saarinens-10-rules-for-crafting-products-that-stand-out/)
- Vercel — [Dashboard redesign](https://vercel.com/blog/dashboard-redesign) · [Nav rollout 2026](https://vercel.com/changelog/dashboard-navigation-redesign-rollout) · [Deployments redesign May 2026](https://vercel.com/changelog/redesigned-deployments-list) · [Geist typography](https://vercel.com/geist/typography) · [Geist colors](https://vercel.com/geist/colors) · [SeedFlip Geist breakdown](https://seedflip.co/blog/vercel-design-system)
- Stripe — [Stripe UI components](https://docs.stripe.com/stripe-apps/components) · [Stripe Refero breakdown](https://styles.refero.design/style/48e5de76-05d5-4c4e-a269-c7c245b291ec) · [Sail by Chase McCoy](https://portfolio.chsmc.org/sail) · [Stripe accessible colors](https://stripe.com/blog/accessible-color-systems)
- Notion — [DesignMD Notion benchmark](https://designmd.cc/benchmarks/notion) · [UI breakdown of Notion's sidebar](https://medium.com/@quickmasum/ui-breakdown-of-notions-sidebar-2121364ec78d) · [Notion sharing](https://www.notion.com/help/sharing-and-permissions)
- GitHub — [Viewing commit history](https://docs.github.com/en/desktop/managing-commits/viewing-the-branch-history-in-github-desktop) · [About commit signature verification](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification) · [Comparing commits](https://docs.github.com/en/pull-requests/committing-changes-to-your-project/viewing-and-comparing-commits/comparing-commits)
- Dropbox (contrast) — [TechSpot 2024 redesign](https://www.techspot.com/news/100467-dropbox-rolls-out-redesigned-web-interface-releases-new.html) · [GoodUX redesign intro](https://goodux.appcues.com/blog/dropbox-redesign)
- Arc — [Wikipedia Arc](https://en.wikipedia.org/wiki/Arc_(web_browser)) · [Blake Crosley Arc](https://blakecrosley.com/guides/design/arc) · [Refine Arc](https://refine.dev/blog/arc-browser/) · [TechCrunch Dia](https://techcrunch.com/2025/11/03/dias-ai-browser-starts-adding-arcs-greatest-hits-to-its-feature-set/)
- Raycast — [Raycast List API](https://developers.raycast.com/api-reference/user-interface/list) · [Raycast UI API](https://developers.raycast.com/api-reference/user-interface)
- 1Password 8 — [1P8 list density (community)](https://1password.community/discussion/122677/item-list-information-density-in-1pw8) · [Knox by Alice Liao](https://aliceliao.com/work/knox) · [Muz.li dark-mode systems](https://muz.li/blog/dark-mode-design-systems-a-complete-guide-to-patterns-tokens-and-hierarchy/)

**Craft / cross-cutting:**
- [rauno.me/craft](https://rauno.me/craft) · [Invisible Details of Interaction Design](https://rauno.me/craft/interaction-design) · [Web Interface Guidelines](https://interfaces.rauno.me/) · [Devouring Details](https://devouringdetails.com/) · [Mantlr: Stripe/Linear/Vercel premium UI](https://mantlr.com/blog/stripe-linear-vercel-premium-ui) · [cmdk by Paco Coursey](https://cmdk.paco.me/)

**Focus & dark mode:**
- [Sara Soueidan on focus indicators](https://www.sarasoueidan.com/blog/focus-indicators/) · [AllAccessible WCAG 2.4.13](https://www.allaccessible.org/blog/wcag-2413-focus-appearance-guide) · [UK Parliament focus state](https://designsystem.parliament.uk/foundations/focus-state/) · [LogRocket linear in light/dark](https://blog.logrocket.com/how-do-you-implement-accessible-linear-design-across-light-and-dark-modes/)

**Tables / patterns:**
- [Pencil & Paper data tables](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables) · [zebra striping analysis](https://medium.com/@designbyfgs/do-zebra-striping-practices-in-table-ui-design-enhance-readability-or-create-visual-noise-5d98cc59f4fd) · [NN/g empty states](https://www.nngroup.com/articles/empty-state-interface-design/) · [NN/g glassmorphism](https://www.nngroup.com/articles/glassmorphism/) · [Eleken sign-up flows 2026](https://www.eleken.co/blog-posts/sign-up-flow)
