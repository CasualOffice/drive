# Spike #5 — SPA shell

Location: [`../../spikes/05-spa-shell/`](../../spikes/05-spa-shell/). Standalone pnpm package.

## Goal

Prove the design-token system from [`../research/04-polish-principles.md`](../research/04-polish-principles.md) §"Starter Token Set" lives cleanly in a Vite + Tailwind v4 setup, and that the empty-state surface from [`../ux/02-surface.md`](../ux/02-surface.md) §7 can be rendered to spec in both light and dark themes without any Phase 1 plumbing.

## Outcome

Green.

- `pnpm install` → 351 packages, ~3 s.
- `pnpm build` → typecheck clean + Vite production build in ~670 ms.
- Output: 198 KB JS (62 KB gzipped), 12 KB CSS (3.7 KB gzipped), 7 Inter font subset woff2 files (~218 KB total uncompressed across all subsets).
- `pnpm dev` serves on `http://127.0.0.1:5183`; index responds 200 with the expected shell.
- Theme toggle cycles `light → dark → system` and persists to `localStorage`.

## What worked

- **Tailwind v4's CSS-only `@theme` directive** is exactly right for this token system. The polish brief's tokens drop in as `:root` CSS variables, then `@theme` exposes a curated subset as Tailwind utilities. No `tailwind.config.js`, no PostCSS plugin chain, no `tailwind.css` separately. The whole config + tokens are a single file.
- **Inter Variable via `@fontsource-variable/inter`** ships the font with the bundle (no Google Fonts hop, no FOIT). Vite's asset hashing picks up all 7 subsets automatically.
- **Theme switching** via `data-theme` attribute + `prefers-color-scheme` media query handles all three states (light / dark / system) with zero JS at runtime once mounted. The CSS-var swap is instant; no flash of mismatched theme.
- **`prefers-reduced-motion`** universal no-op in `styles.css` honours commandment #8 with a single media-query block.
- **Lucide React icons** — `<Cloud>`, `<FolderOpen>`, `<Upload>`, `<Sun>`, `<Moon>` — are tree-shakeable and render cleanly at 16/20/56 px sizes per surface spec.
- **Inline `style={{ ... }}` for token bindings** turns out to be cleaner than memorising the Tailwind utility name for each design token. Token name in CSS == prop name in JSX. Phase 1's web/ will harden this with a typed token helper, but for the spike the directness was a win.

## What surprised

1. **Tailwind v4 needs the Vite plugin (`@tailwindcss/vite`), not the PostCSS pipeline** — easy to follow stale 3.x guides and waste 20 minutes. Worked first try once I used the right plugin.
2. **TypeScript needed a `vite-env.d.ts`** with `declare module "*.css"` + `declare module "@fontsource-variable/inter"` to satisfy side-effect-only imports. Standard Vite + TS pattern, but `strict` + `noUnusedLocals` makes the omission an immediate error.
3. **No `tailwind.config.js` at all in Tailwind 4** is genuinely a different mental model. Took a second pass to internalise.

## What this proves for Phase 1

- The token set is **directly usable** — copy `styles.css`'s `:root` block into `web/src/styles.css` in Phase 1, switch from React stubs to real components, ship.
- The light/dark theme toggle in `App.tsx` is the production pattern; Phase 1 promotes it into a settings page entry alongside the avatar menu.
- The empty-state component is one of the 15 surfaces in `02-surface.md`. The other 14 follow this exact shape: inline tokens, Lucide glyphs, Radix Primitives for any interactive surface (modal/dropdown/etc — added in Phase 1).
- Bundle size for an empty React app + Inter is ~62 KB gzipped — leaves plenty of headroom for shadcn/ui + Radix + Motion + cmdk + vaul + sonner in Phase 1. Target shell budget: < 150 KB gzipped before route-split chunks.

## What's out of this spike (and where it goes)

| Out | Where |
|---|---|
| Sidebar + top-bar full layout | Phase 1 `crates/drive-http`'s SPA mount + `web/src/components/Shell.tsx` |
| Radix Primitives integration (Dialog, DropdownMenu, Tooltip, ToggleGroup) | Phase 1 (per surface spec) |
| shadcn/ui setup | Phase 1 (`pnpm dlx shadcn@latest init`) |
| cmdk command palette | Phase 1 §"Command palette" |
| File-list virtualised table | Phase 1 (`@tanstack/react-virtual`) |
| Motion / Framer Motion | Phase 1 — only when needed; the spike doesn't need any animation library beyond CSS transitions |
| Mobile / narrow-viewport layout | Phase 3 |

## Recommended revisions to docs

- Note in `04-polish-principles.md` that Tailwind v4 + Vite plugin is the production setup (today the brief mentions shadcn/Radix/etc but doesn't pin Tailwind version).
- Add the `vite-env.d.ts` snippet to ARCHITECTURE.md §"Frontend served by Drive" — small enough to be easy to forget, expensive enough to debug.

## Decision

**Greenlit.** Token system + Tailwind v4 setup + Lucide + Inter is the production stack for `web/`. Phase 1 starts by copying this spike's `package.json`/`tsconfig.json`/`vite.config.ts`/`styles.css` into `web/` and growing the component tree against the 15 surface specs.
