# 02 — Doc-Hub SPA: Component Library + Motion Stack Pick (2026)

**Audience:** the frontend engineer wiring Doc-Hub's web UI on React 19 + Vite 7 + Tailwind v4 + TS.
**Purpose:** decide — once — which component library, which motion lib, which form lib, which palette/toast/drawer.
**Polish bar:** Things 3 / Linear / Raycast (see [`04-polish-principles.md`](../research/04-polish-principles.md)).
**Inviolable rule:** Lucide SVG icons. Never emoji.

All version numbers and maintenance claims were cross-checked via WebSearch in June 2026. `[unverified]` marks anything I could not confirm from a primary source.

---

## TL;DR

- **Component layer:** **Radix Primitives** (`radix-ui` 1.4.x umbrella) for accessibility/keyboard/focus; **shadcn/ui** as the copy-paste visual skin on top (now first-class on Tailwind v4 + React 19, with the March 2026 `shadcn` CLI v4 and Sera/Luma presets).
- **Don't** use Mantine / Chakra / MUI — full design systems will fight the @theme tokens you already own.
- **Don't** buy Catalyst at $149 — Catalyst is fine and built by the Tailwind team, but the OSS Radix + shadcn stack now matches it on polish and gives more headroom for a Things-3-shaped product.
- **Motion layer:** **Motion** (the Framer Motion rebrand, `motion` 12.x) using the `m` + `LazyMotion(domAnimation)` pattern → ~4.6 kB initial render. CSS transitions for hover / focus / press; Motion only for layout, gesture, springs.
- **List reorder:** **`@formkit/auto-animate`** as the drop-in for document-list reorder (on rename / move / sort); do not reach for `motion/layout` for this.
- **Adjacent picks:** **`vaul` 1.1.x** for mobile sheets, **`sonner` 2.0.x** for toasts, **`cmdk` 1.1.x** for the command palette (with eyes open — upstream is quiet; have a fork plan).
- **Form layer:** **`react-hook-form` 7.x + zod 4.x**. TanStack Form is great but heavier; Conform is the right call only if Doc-Hub moves to RSC server actions, which it isn't.
- **Icons:** **`lucide-react`** (already mandated). Phosphor as the fallback when a glyph is missing.

---

## Component Library

### Trade-off matrix

| Library                | OOTB polish    | TW v4 fit                  | Customization headroom | Coverage of Doc-Hub's 11 primitives | TS quality        | Bundle @ ~10 primitives |
|------------------------|----------------|----------------------------|------------------------|-----------------------------------|-------------------|--------------------------|
| shadcn/ui (on Radix)   | High           | First-class (v4-ready)     | Full — code lives in your repo | All 11 first-class          | Strong            | ~25-35 kB gz `[unverified]` |
| Radix Primitives (raw) | None (unstyled)| Native — no CSS-in-JS at all | Total                | All 11 except Toast/Command       | Strong            | ~15-25 kB gz `[unverified]` |
| Park UI                | Medium-High    | First-class (TW or Panda)  | Full — copy-paste like shadcn | Most via Ark UI            | Strong            | comparable to shadcn     |
| Tailwind Catalyst      | Very high      | Native — built by TW team  | Full — owned source    | Most; no Command, no Tooltip OOTB | Strong            | Headless UI dep ~25 kB   |
| Ark UI / Zag           | None (headless)| Native (no styles)         | Total                  | All 11 + more                     | Strong            | larger — state machines `[unverified]` |
| Mantine v9             | High           | Conflicts — CSS Modules + own theme | Low — fights your tokens  | All 11 + 100 more            | Strong            | Heavy, full DS           |
| Chakra v3              | High           | Conflicts — Panda CSS recipes | Low — own token system | All 11                          | Strong            | Heavy, full DS           |
| MUI                    | High but Material | Conflicts — emotion-based  | Low — Material visual language  | All 11                  | Strong            | Heaviest of the list     |

### shadcn/ui — yes

The library went through a major rewrite for Tailwind v4 + React 19. The CLI now initializes new projects on v4 by default; every primitive gained a `data-slot` attribute for styling; HSL was migrated to OKLCH; full support landed for the new `@theme` directive and `@theme inline` ([shadcn/ui — Tailwind v4](https://ui.shadcn.com/docs/tailwind-v4), [Discussion #2996](https://github.com/shadcn-ui/ui/discussions/2996)).

The "copy components into your project" model is **still right** — and the March 2026 `shadcn` CLI v4 strengthens it. New flags `--dry-run`, `--diff`, `--view` let you inspect a registry payload before it touches disk, and `registry:base` lets a registry distribute an entire design system as one payload (components + deps + CSS vars + fonts + config) ([CLI v4 changelog](https://ui.shadcn.com/docs/changelog/2026-03-cli-v4), [Mar 2026 update writeup](https://dev.to/codedthemes/shadcnui-march-2026-update-cli-v4-ai-agent-skills-and-design-system-presets-1gp1)). April 2026 added shadcn presets (Sera, Luma), Pointer Cursor, Partial Preset Apply, and Component Composition ([changelog](https://ui.shadcn.com/docs/changelog)).

What ships: Accordion, Alert, Alert Dialog, Aspect Ratio, Avatar, Badge, Breadcrumb, Button, Calendar, Card, Carousel, Chart, Checkbox, Collapsible, Command (cmdk), Context Menu, Data Table, Date Picker, Dialog, Drawer (vaul), Dropdown Menu, Form (RHF + Zod), Hover Card, Input, Input OTP, Label, Menubar, Navigation Menu, Pagination, Popover, Progress, Radio Group, Resizable, Scroll Area, Select, Separator, Sheet, Sidebar, Skeleton, Slider, Sonner (toast), Switch, Table, Tabs, Textarea, Toggle, Toggle Group, Tooltip — i.e. every primitive Doc-Hub needs, all behind Radix + already wired to the Lucide+ Tailwind+ Inter aesthetic Doc-Hub is targeting.

**The shadcn copy-paste model is also the only one that gives Doc-Hub the polish headroom it needs.** Every micro-detail from `04-polish-principles.md` (concentric radii, hairline borders, inner-shadow inputs, `cubic-bezier(0.32, 0.72, 0, 1)` ease-out, focus ring at 60% accent) requires reaching *into* the component CSS. With shadcn the CSS is yours. With Mantine/Chakra/MUI it's two layers of overrides.

### Radix Primitives — yes (under shadcn)

Maintained by WorkOS since the Modulz acquisition. The umbrella `radix-ui` package (1.4.x as of April 2026) re-exports every primitive from one place to avoid `node_modules` bloat ([GitHub](https://github.com/radix-ui/primitives), [Issue #3854](https://github.com/radix-ui/primitives/issues/3854)). ~28-30 primitives covering everything Doc-Hub needs except Command/Toast/Drawer ([Radix Primitives](https://www.radix-ui.com/primitives)). Recent additions include a preview `OneTimePasswordField` ([releases](https://github.com/radix-ui/primitives/releases)).

Radix is **the foundation layer** for shadcn/ui — Dialog, DropdownMenu, Popover, Tabs, Tooltip, ToggleGroup, ScrollArea, Switch, Slider all come from Radix. Picking shadcn implicitly picks Radix; this is correct.

### Park UI — pass

Park UI is the shadcn-shaped alternative that swaps Radix for Ark UI / Zag.js and Panda CSS for Tailwind ([park-ui.com](https://park-ui.com/)). Real, currently-maintained, ~2.2k stars in 2026, Tailwind-v4 variant ships ([best-tailwind-libs roundup](https://designrevision.com/blog/best-tailwind-component-libraries), [tailkits entry](https://tailkits.com/components/park-ui/)). Worth knowing only if you've decided to standardize on Ark UI / Panda CSS — which Doc-Hub hasn't. Pass.

### Tailwind Catalyst — pass (with respect)

Built by the Tailwind team on top of Headless UI; you download the source, you own it, just like shadcn ([Catalyst docs](https://catalyst.tailwindui.com/docs), [LogRocket review](https://blog.logrocket.com/exploring-catalyst-tailwind-ui-kit-react/)). One-time $149 for the Catalyst toolkit license, $299 for All-Access ([Tailwind Plus](https://tailwindcss.com/plus)). Ships Dialog, Dropdown, Select, Input, Listbox, Button, Avatar, Badge, Switch, Table, application layouts — but **no Command Palette, no Toast, no Tooltip primitive of comparable maturity to Radix Tooltip**, no Drawer ([dialog doc](https://catalyst.tailwindui.com/docs/dialog), [dropdown doc](https://catalyst.tailwindui.com/docs/dropdown)).

Catalyst is excellent. Radix + shadcn just happens to give Doc-Hub equivalent polish, more primitives, more public momentum, and zero license. Pass.

### Ark UI / Zag — pass

`@ark-ui/react` ~311k weekly downloads in early 2026 ([package](https://www.npmjs.com/package/@ark-ui/react)). 45+ headless primitives, framework-agnostic, each component is a finite state machine in Zag.js ([Ark intro](https://ark-ui.com/docs/overview/introduction), [Ark vs Zag](https://github.com/chakra-ui/ark/discussions/2795)). Documentation refresh January 2026 added live interactive previews per component.

It is technically excellent and probably *more* rigorous than Radix on edge-case state. But it brings no styled components of its own — Doc-Hub would need to either pull in Park UI (which means adopting Panda CSS or starting style-from-scratch) or roll a shadcn-equivalent registry by hand. That's months of work for a small accessibility delta that Radix already covers. Pass.

### Mantine / Chakra / MUI — pass, all three

All three are *design systems*, not primitives:

- **Mantine v9** (released 31 March 2026) has 120+ components, hooks library, CSS Modules architecture ([Mantine v9 comparison](https://adminlte.io/blog/mantine-vs-chakra-ui-vs-mui/)). Beautiful, fast, very productive — and a hard fight if you want a Things 3 look, because every component carries Mantine's visual language and `<MantineProvider>` ships its own theme system that does not compose with Tailwind v4's `@theme`.
- **Chakra v3** (Oct 2024 ground-up rewrite) replaced style-props with Panda CSS recipes, integrated Ark UI state machines, dropped Framer Motion in favor of native CSS animations ([Chakra v3 notes](https://adminlte.io/blog/mantine-vs-chakra-ui-vs-mui/)). Same issue — its token system competes with Tailwind v4.
- **MUI** is Material-Design-shaped; emotion-based; great enterprise moat (data grid, commercial support) — wrong polish bar.

Picking any of these means accepting their visual identity and ~80-150 kB of components you'll never use, plus a wrestling match with Tailwind v4 tokens. The Doc-Hub UI we want is a content-led canvas with hidden chrome; design-system suites push back on that.

### Pick

**Radix Primitives (via `radix-ui` umbrella) + shadcn/ui copy-paste components, on Tailwind v4 + React 19.**

Why this and not the alternatives:
1. Every Doc-Hub primitive (Dialog, DropdownMenu, Popover, Tooltip, ToggleGroup, ScrollArea, Tabs, ContextMenu, Switch, Slider, Toast-via-sonner, Command-via-cmdk) is first-class. Coverage = 100%.
2. The code lives in Doc-Hub's repo; we can edit any component to enforce the 10 Commandments without monkey-patching a vendor lib.
3. Tailwind v4 + React 19 are both first-class; the `@theme` tokens in `04-polish-principles.md` drop in without ceremony.
4. Public momentum: this is what Linear-shaped products are built on in 2026.

---

## Motion Library

### Trade-off matrix

| Lib                            | Install                          | Latest                | Cost                              | Best for                            |
|--------------------------------|----------------------------------|-----------------------|-----------------------------------|-------------------------------------|
| **Motion** (was Framer Motion) | `pnpm add motion`                | 12.27.x (Jan 2026)    | 34 kB full · 4.6 kB w/ LazyMotion+`m` | Springs, layout, gesture, exit anim |
| **Motion One**                 | `pnpm add motion`                | 10.x core             | ~3-5 kB                           | Bundle-critical micro-animation     |
| **@formkit/auto-animate**      | `pnpm add @formkit/auto-animate` | 0.9.x                 | ~2 kB `[unverified]`              | List add/remove/reorder             |
| CSS transitions                | nothing                          | n/a                   | 0 kB                              | hover/focus/press/route-fade        |
| **vaul** (drawer)              | `pnpm add vaul`                  | 1.1.2 (mid-2025)      | small                             | Mobile sheets, drag-to-dismiss      |
| **sonner** (toast)             | `pnpm add sonner`                | 2.0.7 (~Aug 2025)     | small                             | Toasts; shadcn default              |
| **cmdk** (palette)             | `pnpm add cmdk`                  | 1.1.1 (>12 mo old)    | small                             | Cmd-K command palette               |

### Motion (formerly Framer Motion) — yes

Framer Motion became independent and rebranded as Motion at [motion.dev](https://motion.dev/) ([rebrand notice](https://forums.tumult.com/t/motion-dev-now-becomes-independent-and-uses-vanilla-javascript/24256), [fireup writeup](https://fireup.pro/news/framer-motion-becomes-independent-introducing-motion)). The package name moved from `framer-motion` to `motion` and imports moved from `framer-motion` to `motion/react` ([upgrade guide](https://motion.dev/docs/react-upgrade-guide)). Both names still resolve; `framer-motion` is the legacy alias.

Bundle: the full `motion` component is ~34 kB. With the `m` component + `LazyMotion` pattern Doc-Hub can ship **~4.6 kB initial render**, then lazy-load `domAnimation` (+15 kB) for animations/variants/exit/tap-hover-focus or `domMax` (+25 kB) when drag/pan/layout is on the page ([LazyMotion docs](https://motion.dev/docs/react-lazy-motion), [reduce bundle](https://motion.dev/docs/react-reduce-bundle-size)). Doc-Hub: wrap the SPA in `<LazyMotion features={domAnimation}>` once, use `m.div` everywhere, escalate to `domMax` only on the drag/upload screen.

Latest version 12.27.5 was verified 2026-01-21 ([changelog](https://motion.dev/changelog)). Motion now also ships vanilla and Vue APIs.

### Motion One — pass

Bundle hero (~3 kB core `animate()`, all on the Web Animations API) ([Motion One bg](https://knaap.dev/posts/a-short-introduction-to-motion-one/), [Motion vs Motion One](https://motion.dev/magazine/should-i-use-framer-motion-or-motion-one)). But it lacks spring physics, layout animations, exit animations, gesture handling — i.e. exactly the things Doc-Hub needs for direct-manipulation polish. Motion with LazyMotion gets to ~4.6 kB anyway and gives Doc-Hub the spring presets `04-polish-principles.md` already specifies. Pass.

### @formkit/auto-animate — yes (narrow)

Zero-config, drop-in, single hook (`useAutoAnimate`) on a list container; smoothly animates add / remove / reorder ([site](https://auto-animate.formkit.com/), [npm](https://www.npmjs.com/package/@formkit/auto-animate)). 0.9.x current, ~2 kB. Doc-Hub's document list is the canonical use case — when a document is added, moved, renamed, or re-sorted, the row slides into its new slot. (A committed version is never optimistically reordered — the list reflows only when the server confirms.) Doing the same with Motion's `<Reorder.Group>` is more code for an identical result.

### CSS-only transitions — yes (the bulk)

The case for going framework-less: hover, focus, press, color tints, opacity fades, route-level fade-throughs are *trivially* expressed in CSS, run on the compositor, cost zero bytes, and never desync with React state. Motion earns its bundle for **springs, layout shifts, exits, gestures**. Use CSS for everything else. Doc-Hub's tokens already define `--ease-out: cubic-bezier(0.32, 0.72, 0, 1)` and `--dur-fast/base/slow/slower` — apply those, not `motion`.

### vaul, sonner, cmdk

These are not motion libraries in the same sense — they're component primitives with motion baked in. Worth covering because the stack pick has to mention them.

- **vaul 1.1.2** — Emil Kowalski's drawer for React, built on Radix Dialog, drag-to-dismiss, used by Vercel in prod, 2,200+ dependents ([GitHub](https://github.com/emilkowalski/vaul), [npm](https://www.npmjs.com/package/vaul)). Last published mid-2025 — not actively churning but stable. Doc-Hub uses it for mobile bottom sheets and any drag-to-dismiss surface.
- **sonner 2.0.7** — Emil Kowalski's toast, shadcn/ui's default Toaster component, 3,672 dependents ([GitHub](https://github.com/emilkowalski/sonner), [npm](https://www.npmjs.com/package/sonner)). Doc-Hub uses it for "Created.", "Couldn't reach the server." — the Linear-voice confirmations from §15 of polish-principles.
- **cmdk 1.1.1** — Paco Coursey's command menu; what Linear, Vercel, Raycast use ([npm](https://www.npmjs.com/package/cmdk)). **Caveat:** the npm package hasn't seen a release in 12+ months; Snyk's analysis flags low maintainer activity ([cmdk on Snyk](https://security.snyk.io/package/npm/cmdk)). Active forks exist (`cmdk-base`, `@udecode/cmdk`). For v0 the upstream is fine — it's a tiny, mostly-feature-complete library — but if Doc-Hub ever needs a fix the realistic plan is to fork. Worth saying out loud now.

### Motion stack pick

- **For Doc-Hub use Motion (`motion` 12.x) for** springs, layout animations, exit transitions, drag/gesture (Magic Plus-style affordances), and any direct-manipulation polish. Always behind `LazyMotion` + `m.` components.
- **Use `@formkit/auto-animate` for** the document list when rows are added, removed, or reordered.
- **Use CSS transitions for** hover, focus, press, color tints, opacity, route fade-throughs — i.e. the 80% of motion that doesn't need React state.
- **Use vaul for** mobile sheets, **sonner for** toasts, **cmdk for** the command palette. Plan to fork cmdk if it goes silent for another year.

---

## Form Layer

Doc-Hub ships exactly one form for v0: the auth form. Don't over-engineer.

- **`react-hook-form` 7.x + `zod` 4.x + `@hookform/resolvers`** — ~12 kB gz, works with React 19, integrated as `Form` in shadcn/ui, "battle-tested, performant, great ecosystem" ([2026 form-lib comparison](https://www.pkgpulse.com/guides/best-react-form-libraries-2026), [Formisch comparison](https://formisch.dev/blog/react-form-library-comparison/)).
- **TanStack Form** — first-class TS inference RHF can't match, but heavier and over-engineered for one auth form ([TanStack comparison](https://tanstack.com/form/latest/docs/comparison)).
- **Conform** — the right answer *only* if Doc-Hub moves to Next.js App Router server actions, because Conform optimizes for progressively enhanced server actions with one Zod schema shared client/server ([Conform](https://conform.guide/), [server-actions guide](https://www.robinwieruch.de/next-forms/)). Doc-Hub is Vite SPA — not the architecture Conform is built for.

**Pick: `react-hook-form` + `zod`.** It's the default shadcn `Form` already uses, and Doc-Hub's auth form is two fields and a button.

---

## Doc-Hub SPA dependencies — final pick

```bash
# Components / primitives (Radix + shadcn lives in your repo)
pnpm add radix-ui                        # 1.4.x umbrella — re-exports all Radix primitives

# shadcn copy-paste components, on demand via the v4 CLI
pnpm dlx shadcn@latest init              # initializes Tailwind v4 + React 19 setup
pnpm dlx shadcn@latest add button input label dialog dropdown-menu popover \
  tooltip toggle-group scroll-area tabs context-menu sheet skeleton form

# Motion
pnpm add motion                          # 12.27.x — use `m` + LazyMotion(domAnimation)
pnpm add @formkit/auto-animate           # 0.9.x — list reorder

# Component primitives with built-in motion
pnpm add vaul                            # 1.1.2 — mobile drawer/sheet
pnpm add sonner                          # 2.0.7 — toasts (shadcn's Toaster)
pnpm add cmdk                            # 1.1.1 — command palette (fork plan if upstream stays silent)

# Icons (locked by polish principles)
pnpm add lucide-react                    # 1,800+ glyphs, ISC

# Forms
pnpm add react-hook-form zod @hookform/resolvers

# Utility helpers shadcn pulls in
pnpm add class-variance-authority clsx tailwind-merge
```

| Layer            | Pick                                  | Version (Jun 2026)       | Why                                                          |
|------------------|---------------------------------------|--------------------------|--------------------------------------------------------------|
| Primitives       | `radix-ui` (WorkOS-maintained)        | 1.4.x umbrella           | 28-30 a11y-correct primitives; under shadcn anyway          |
| Components       | shadcn/ui copy-paste via `shadcn` CLI | CLI v4 (Mar 2026)        | Code lives in repo; full Tailwind v4 + React 19; OKLCH; Sera/Luma presets |
| Motion           | `motion`                              | 12.27.x                  | Springs, layout, gesture; 4.6 kB with LazyMotion+`m`        |
| List reorder     | `@formkit/auto-animate`               | 0.9.x                    | Zero-config one-hook drop-in; ~2 kB                          |
| Drawer / sheet   | `vaul`                                | 1.1.2                    | Built on Radix Dialog; Vercel-grade                          |
| Toast            | `sonner`                              | 2.0.7                    | Default shadcn Toaster; Linear-voice "Created." fits         |
| Command palette  | `cmdk`                                | 1.1.1                    | What Linear/Vercel/Raycast use; have a fork plan             |
| Icons            | `lucide-react`                        | per polish principles    | 1,800+ glyphs; same family across the app                    |
| Forms            | `react-hook-form` + `zod`             | 7.x / 4.x                | Smallest + shadcn's `Form` already uses it                   |
| Don't install    | Mantine / Chakra / MUI / Ark UI / Park UI / Catalyst / Motion One | — | Either visually opinionated or solves a problem Doc-Hub doesn't have |

---

## Sources

shadcn/ui & Radix:
- [shadcn/ui — Tailwind v4](https://ui.shadcn.com/docs/tailwind-v4) · [Changelog](https://ui.shadcn.com/docs/changelog) · [CLI v4 (Mar 2026)](https://ui.shadcn.com/docs/changelog/2026-03-cli-v4) · [Discussion #2996](https://github.com/shadcn-ui/ui/discussions/2996) · [DEV writeup of Mar 2026 update](https://dev.to/codedthemes/shadcnui-march-2026-update-cli-v4-ai-agent-skills-and-design-system-presets-1gp1)
- [Radix Primitives](https://www.radix-ui.com/primitives) · [GitHub](https://github.com/radix-ui/primitives) · [Releases](https://github.com/radix-ui/primitives/releases) · [umbrella package #3854](https://github.com/radix-ui/primitives/issues/3854) · [Releases doc](https://www.radix-ui.com/primitives/docs/overview/releases)

Alternatives considered:
- [Park UI](https://park-ui.com/) · [Park UI on Tailkits](https://tailkits.com/components/park-ui/) · [Best Tailwind libs 2026](https://designrevision.com/blog/best-tailwind-component-libraries)
- [Catalyst docs](https://catalyst.tailwindui.com/docs) · [Catalyst Dialog](https://catalyst.tailwindui.com/docs/dialog) · [Catalyst Dropdown](https://catalyst.tailwindui.com/docs/dropdown) · [Tailwind Plus pricing](https://tailwindcss.com/plus) · [Catalyst intro post](https://tailwindcss.com/blog/introducing-catalyst) · [LogRocket: Catalyst](https://blog.logrocket.com/exploring-catalyst-tailwind-ui-kit-react/)
- [Ark UI](https://ark-ui.com/) · [@ark-ui/react npm](https://www.npmjs.com/package/@ark-ui/react) · [GitHub](https://github.com/chakra-ui/ark) · [Ark vs Zag](https://github.com/chakra-ui/ark/discussions/2795)
- [Mantine vs Chakra vs MUI 2026](https://adminlte.io/blog/mantine-vs-chakra-ui-vs-mui/) · [HeroUI: 12 best component libs](https://heroui.com/blog/best-react-ui-component-libraries) · [Best React UI 2026 (Boundev)](https://www.boundev.ai/blog/top-react-ui-frameworks-guide)

Motion:
- [Motion docs](https://motion.dev/) · [Reduce bundle size](https://motion.dev/docs/react-reduce-bundle-size) · [LazyMotion](https://motion.dev/docs/react-lazy-motion) · [Upgrade guide](https://motion.dev/docs/react-upgrade-guide) · [Changelog](https://motion.dev/changelog) · [Should I use Framer Motion or Motion One?](https://motion.dev/magazine/should-i-use-framer-motion-or-motion-one) · [Rebrand notice](https://forums.tumult.com/t/motion-dev-now-becomes-independent-and-uses-vanilla-javascript/24256) · [fireup write-up](https://fireup.pro/news/framer-motion-becomes-independent-introducing-motion)
- [framer-motion npm (legacy)](https://www.npmjs.com/package/framer-motion)
- [Motion One intro (knaap.dev)](https://knaap.dev/posts/a-short-introduction-to-motion-one/) · [Exploring Motion One (LogRocket)](https://blog.logrocket.com/exploring-motion-one-framer-motion/)
- [LogRocket: best React animation libs 2026](https://blog.logrocket.com/best-react-animation-libraries/) · [PkgPulse: best React animation libs 2026](https://www.pkgpulse.com/guides/best-react-animation-libraries-2026)

Adjacent libs:
- [@formkit/auto-animate site](https://auto-animate.formkit.com/) · [GitHub](https://github.com/formkit/auto-animate) · [npm](https://www.npmjs.com/package/@formkit/auto-animate)
- [vaul GitHub](https://github.com/emilkowalski/vaul) · [vaul site](https://vaul.emilkowal.ski/) · [vaul npm](https://www.npmjs.com/package/vaul)
- [sonner GitHub](https://github.com/emilkowalski/sonner) · [sonner npm](https://www.npmjs.com/package/sonner) · [shadcn Sonner doc](https://ui.shadcn.com/docs/components/radix/sonner)
- [cmdk npm](https://www.npmjs.com/package/cmdk) · [cmdk on Snyk](https://security.snyk.io/package/npm/cmdk)

Forms:
- [PkgPulse: form libs 2026](https://www.pkgpulse.com/guides/best-react-form-libraries-2026) · [Formisch comparison](https://formisch.dev/blog/react-form-library-comparison/) · [TanStack Form comparison](https://tanstack.com/form/latest/docs/comparison) · [Peerlist: TanStack vs RHF](https://peerlist.io/saxenashikhil/articles/tanstack-form-vs-react-hook-form--which-one-should-you-use) · [Conform](https://conform.guide/) · [Conform GitHub](https://github.com/edmundhung/conform) · [Robin Wieruch: Next.js server actions 2026](https://www.robinwieruch.de/next-forms/)
