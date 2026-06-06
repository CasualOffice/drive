# Spike #5 — SPA shell

React 19 + Vite 7 + TypeScript 5 + Tailwind v4 + Lucide on Inter Variable. The design tokens from [`docs/research/04-polish-principles.md`](../../docs/research/04-polish-principles.md) §"Starter Token Set" ported verbatim into [`src/styles.css`](./src/styles.css). The empty-state surface from [`docs/ux/02-surface.md`](../../docs/ux/02-surface.md) §7 rendered in [`src/components/EmptyState.tsx`](./src/components/EmptyState.tsx). Light/dark theme switching with `prefers-color-scheme` + manual override via `data-theme`.

## Run

```bash
pnpm install
pnpm dev       # http://127.0.0.1:5183
pnpm build     # typecheck + production build → dist/
pnpm preview   # serve dist/
```

## Files

- `src/styles.css` — design tokens (light + dark), `@theme` bridge, `prefers-reduced-motion` no-op.
- `src/App.tsx` — app shell (top bar + theme toggle).
- `src/components/EmptyState.tsx` — the first-run surface.

## Decision

See [`../../docs/spikes/05-spa-shell.md`](../../docs/spikes/05-spa-shell.md).
