# 07 — Marketing site

Research brief for the GitHub Pages marketing/docs site that wraps the Doc-Hub demo. Decided in conversation 2026-06-07; repositioned for the Drive→Doc-Hub revamp.

## Positioning

Doc-Hub is **not** a self-hosted Google Drive/Dropbox competitor and the site must never frame it as one. It is an **encrypted, tamper-evident document hub and registry** — a place teams and individuals *keep* the documents they can't afford to lose or leak, with a history they can prove. The three hooks the whole site leans on:

1. **Compliance.** Append-only, hash-chained audit log; retention policies; legal hold; document signing/provenance; exportable, verifiable reports.
2. **Immutable history.** Every save appends a new hash-chained version. Nothing is overwritten or hard-deleted. Alter any past byte and verification fails.
3. **Native editing.** `.docx`/`.xlsx`/`.pdf`/`.md` open in embedded editors with real-time co-editing — inside the hub, not a launcher to someone else's app.

Documents only (`docx, xlsx, csv, xlsm, pptx, pdf, md, txt, json, yaml`). No video, no media previews, no "put anything here." Say so — the narrow scope is a selling point (it's what lets us encrypt, index, and version everything).

Honesty rule: encryption is at-rest (AES-256-GCM envelope) + in-transit (TLS), **server-trusted, not zero-knowledge E2E** — chosen so the server can index and run AI over content. The site never implies E2E. It defends a stolen disk/DB, not a compromised server.

## Goals

1. Get found. Self-hosters searching "self-hosted document management", "encrypted document hub", "tamper-evident audit trail", "self-hosted DigiLocker" should land on us — not "Google Drive alternative" traffic we can't honestly serve.
2. Convert. A first-time visitor should reach the demo in two clicks and the install instructions in one.
3. Stay fast on mobile. Lighthouse Performance ≥ 95 on a throttled mobile 4G profile.
4. Stay coherent. Marketing surface ≠ Doc-Hub UI in vocabulary, but ≡ in token system + a11y baseline + theme support.

## Stack — Astro 5

- **Why Astro over Next.js / Vite / plain HTML:**
  - Default output is real static HTML. Crawlers see indexable content immediately — no hydration wait, no "JS-rendered" indexing degradation.
  - Zero JS on a page by default. Islands hydrate only when annotated (`client:load`, `client:visible`, `client:idle`). The /demo route mounts the existing Doc-Hub SPA as a single island; every other page ships 0 KB of JS.
  - MDX for the docs pages → docs authored as Markdown but can drop in Astro components inline (`<Callout/>`, `<CodeBlock/>`).
  - First-class `<Image>` with AVIF/WebP fallbacks, responsive `srcset`, explicit `width`/`height` to kill CLS.
  - First-class `@astrojs/sitemap` + RSS, no glue code.
- **Version pin:** Astro `5.x`, Node 20+. MDX integration via `@astrojs/mdx`.

## Layout — multi-page docs site

Six indexable pages + one demo route. Each page = its own `<title>`, `<meta name="description">`, canonical URL, OG card → each ranks for its own niche query.

| Route | Page | Long-tail target |
|---|---|---|
| `/` | Landing | "self-hosted document hub", "encrypted document registry", "tamper-evident document store" |
| `/docs/install` | Install (Docker + cargo) | "casual hub install", "self host document hub docker" |
| `/docs/configuration` | Configuration (env vars, encryption keys, storage, two-origin) | "casual hub config", "hub master key kms", "hub minio s3" |
| `/docs/contributing` | Contributing | "casual hub contribute" |
| `/docs/architecture` | Architecture (encryption + immutable history + diagram) | "casual hub architecture", "self-hosted encrypted document store", "hash-chained version history" |
| `/screenshots` | Gallery | image search referrals |
| `/demo` | Live demo (the SPA in demo mode) | conversion target, `noindex` |

## SEO checklist (every page)

- Unique `<title>` (50–60 chars), `<meta name="description">` (140–160 chars).
- Canonical URL (`<link rel="canonical">`) — absolute, never relative.
- Open Graph (`og:title`, `og:description`, `og:image`, `og:type`, `og:url`) + Twitter card (`twitter:card="summary_large_image"`).
- JSON-LD `SoftwareApplication` on `/`, `SoftwareSourceCode` on `/docs/architecture`, `FAQPage` if we add FAQ to `/` (good place to answer "is it end-to-end encrypted?" honestly).
- `sitemap.xml` auto-generated via `@astrojs/sitemap`.
- `robots.txt` allows all but explicitly disallows `/demo` (it's the running app, not content — also we don't want demo-account audit-log noise in search results).
- `noindex` meta on `/demo` itself.
- Semantic HTML: one `<h1>` per page, `<main>`, `<nav>`, `<article>`, `<section>`. No `<div>` soup.
- `lang="en"` on `<html>`.
- All images have `alt`. Decorative images get `alt=""`.

## Performance budget

Targets — checked via Lighthouse mobile profile + WebPageTest.

| Metric | Budget |
|---|---|
| Lighthouse Performance | ≥ 95 |
| LCP | < 1.5 s on 4G |
| TBT | < 100 ms |
| CLS | < 0.05 |
| First-load JS (landing) | < 30 KB total (after gzip) |
| First-load CSS (landing) | < 20 KB total (after gzip) |
| First-load HTML (landing) | < 50 KB |
| Hero image | < 80 KB AVIF |
| Total page weight (landing) | < 250 KB on first visit |

Techniques:

- Self-host **Inter** (subset to latin + latin-ext) in `public/fonts/`. Preload the regular + medium weights. `font-display: swap`.
- `<Image>` component for every raster image. AVIF first, WebP fallback, `loading="lazy"` for below-fold, `decoding="async"`.
- Always set explicit `width` + `height` (or `aspect-ratio` CSS) on images to prevent CLS.
- `content-visibility: auto` on big below-fold sections so the browser skips paint until scroll.
- Inline critical CSS for above-the-fold (Astro does this when CSS is < 4 KB).
- Defer or remove third-party scripts. No analytics SDK; if we add analytics it's server-side or Plausible's 1-pixel image variant.
- The `/demo` SPA bundle stays out of every other page's payload — it's only fetched on demo navigation.

## Mobile-first approach

- Default styles target **360 px** width (smallest common Android viewport, 2026). Larger viewports add layout via `min-width` media queries.
- Breakpoints — only when content actually breaks at the boundary, not arbitrary:
  - **sm:** `min-width: 640px` (large phones, small tablets, landscape phone)
  - **md:** `min-width: 768px` (tablets portrait)
  - **lg:** `min-width: 1024px` (tablets landscape, small laptops)
  - **xl:** `min-width: 1280px` (desktop)
- Touch targets ≥ 44×44 px (WCAG 2.5.5 AAA). Spacing ≥ 8 px between tap targets.
- No horizontal scroll at any viewport ≥ 320 px. `overflow-x: clip` on `<body>`.
- Viewport meta: `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`.
- `prefers-reduced-motion: reduce` honoured (same as Doc-Hub — commandment 8).
- Light + dark themes, OS-pref by default, manual toggle override persisted to `localStorage`.

## GitHub Pages deployment

- Repository: same monorepo (`dochub/`). Site lives at `marketing/`.
- Workflow file: `.github/workflows/pages.yml`. Triggers: `push` to `main` paths `marketing/**` + `web/**` (so SPA changes rebuild the demo bundle too).
- Build:
  1. Build SPA (`web/`) with `VITE_DEMO_MODE=true` → produces `web/dist/`.
  2. Copy `web/dist/` → `marketing/public/demo-app/` (the Astro `/demo` route loads this).
  3. Run `astro build` → `marketing/dist/` is the deploy artifact.
- Deploy via `actions/upload-pages-artifact@v3` + `actions/deploy-pages@v4`.
- Initial host: `https://<gh-org>.github.io/dochub/` (need `site` + `base` in `astro.config.mjs`). Migrate to `doc-hub.casualoffice.org` when DNS lands — flip `site` + drop `base`.
- `404.html` is Astro's default 404 page (not the SPA fallback hack — Astro routes are static so 404 lookups land on the right thing).

## Out of scope (v0)

- A blog. Slot for `/blog` reserved in the layout footer; no posts yet.
- i18n. English only; structure leaves room for `astro-i18n`.
- Search across docs. Pages are few enough that Cmd-F is fine; Pagefind drops in later.
- Newsletter capture. No mailing list yet — link to GitHub Discussions for now.
- A11y audit beyond automated tools. Manual screen-reader pass deferred to v0.2.
