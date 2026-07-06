# 14 — Marketing site surface

Companion to `docs/research/07-marketing-site.md`. Page-by-page surface spec for the Astro marketing site at `dochub.casualoffice.org`. This is the one place the voice may be persuasive — but still tight, honest, sentence-case, and free of exclamation marks and hype.

## Flows

1. **Discover** — visitor lands on `/`. The hero says what Doc-Hub is (an encrypted, tamper-evident document hub you self-host) with a Demo CTA and a Self-host CTA in the first viewport.
2. **Try** — Demo CTA → `/demo` → SPA loads in demo mode, seeded admin already signed in. No setup screen, no real password.
3. **Install** — Self-host CTA → `/docs/install` → copy/paste Docker one-liner + cargo path.
4. **Configure** — `/docs/configuration` lists every env var (storage backend, two-origin hosts, master key / KMS, SMTP) with a default and an example.
5. **Understand** — `/docs/architecture` shows the diagram, the encryption + hash-chain model, and the token model.
6. **Contribute** — `/docs/contributing` covers repo layout, dev loop, PR conventions, the inviolable rules (linked to `CLAUDE.md`).
7. **Browse** — `/screenshots` is a lightboxable gallery; each shot has a one-line caption.
8. **Return** — footer surfaces the GitHub repo, discussions, license, sister projects.

## Global chrome

```
┌─ Top nav (sticky on desktop, collapse-to-hamburger on mobile) ───┐
│  [Logo] Doc-Hub      Docs ▾   Screenshots   Demo   GitHub   │
│                           │                                       │
│                           └─ Install / Configuration /            │
│                              Architecture / Contributing          │
└──────────────────────────────────────────────────────────────────┘

… page body …

┌─ Footer ──────────────────────────────────────────────────────────┐
│  Doc-Hub · part of Casual Office · Apache-2.0                │
│  Repo   Discussions   Issues   Releases   Sheet ↗   Docs ↗        │
│  © 2026 — casualoffice.org                                         │
└──────────────────────────────────────────────────────────────────┘
```

- Top nav background blurs on scroll (`backdrop-filter: blur(8px)`).
- Theme toggle far right (icon-only, Lucide `Sun`/`Moon`).
- Skip-link `Skip to content` on first focus.

## Mobile chrome (≤ 640 px)

```
┌─ Top nav ─────────────────────────────────────────┐
│  [Logo] Doc-Hub                       [Menu] │
└───────────────────────────────────────────────────┘
            ↓ tap menu
┌─ Sheet (vaul drawer, slides up) ──────────────────┐
│  Docs → Install / Configuration /                 │
│         Architecture / Contributing               │
│  Screenshots                                      │
│  Demo                                             │
│  GitHub  ↗                                        │
│  ──────  Theme  ◐                                 │
└───────────────────────────────────────────────────┘
```

- Drawer is a `vaul`-style sheet from the bottom, snap 50/100%.
- Tap targets 44 × 44 minimum.

## `/` — landing

```
┌─ Hero (full-bleed, gradient fade) ────────────────────────────────┐
│                                                                    │
│   A hub for the documents you can't afford to lose or leak.      │
│   Doc-Hub is an open-source, self-hosted document hub:      │
│   encrypted at rest, versioned forever, searchable by content —    │
│   and edited natively in the browser. Your server, your keys.      │
│                                                                    │
│   [ Try the demo ]   [ Self-host in 30 seconds ]                  │
│                                                                    │
│   ★ Apache-2.0  ·  Rust + React  ·  Single binary  ·  Docker      │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
┌─ Screenshot showcase (hover-cycle) ───────────────────────────────┐
│   [ wide screenshot — document list + version history, dark ]     │
│   Documents · Editor · Version history · Compliance               │
└────────────────────────────────────────────────────────────────────┘
┌─ Feature grid (3-up desktop, 1-up mobile) ────────────────────────┐
│ [ico] Permanent history   [ico] Encrypted at rest [ico] Native    │
│ hash-chained versions,    AES-256-GCM envelope,   editing         │
│ nothing overwritten       your keys/KMS           Sheet/Docs/PDF   │
│                                                    in the browser  │
│ [ico] Content search      [ico] Compliance        [ico] Self-host │
│ find the document that    audit log, retention,   one binary,     │
│ mentions X, snippets      legal hold, provenance  fs / S3 / MinIO │
└────────────────────────────────────────────────────────────────────┘
┌─ How it works (3 steps) ───────────────────────────────────────────┐
│   1. docker run … (with a master key)                              │
│   2. Open https://hub.your-server, create a project              │
│   3. Upload a document, edit it, watch the version chain grow       │
└────────────────────────────────────────────────────────────────────┘
┌─ Trust section (the four promises) ───────────────────────────────┐
│   History is permanent · Documents are encrypted ·                 │
│   Editing is native · Everything is findable                       │
│   (one honest paragraph each, linking to /docs/architecture)       │
└────────────────────────────────────────────────────────────────────┘
┌─ Comparison table (Doc-Hub vs Drive/Dropbox vs Nextcloud) ───┐
│   documents-only · at-rest encryption you control · immutable      │
│   hash-chained history · content search · self-host — honest ✓/✗   │
└────────────────────────────────────────────────────────────────────┘
┌─ Honest-limits note ───────────────────────────────────────────────┐
│   Not zero-knowledge E2E — the server holds keys so it can index    │
│   and reason over your documents. It defeats a stolen disk or DB,   │
│   not a fully compromised server. Documents only: no video, media,  │
│   or arbitrary files. (links to the security brief)                 │
└────────────────────────────────────────────────────────────────────┘
┌─ Final CTA ────────────────────────────────────────────────────────┐
│   Ready?  [ Demo ]  [ Install ]  [ ★ Star on GitHub ]              │
└────────────────────────────────────────────────────────────────────┘
```

- Hero `<h1>` is the only `<h1>` on the page.
- The **honest-limits note** is deliberate marketing copy: stating the server-trusted trade and the documents-only scope up front is a trust signal, not a caveat to bury.
- Screenshot showcase uses `<Image>` with `loading="eager"` for the first frame, `lazy` for the rest — of product surfaces only (document list, editor, version history), never user media.
- Feature grid is `display: grid`; mobile `1fr`, sm `1fr 1fr`, lg `1fr 1fr 1fr`.
- Comparison table on mobile collapses to horizontal-scroll inside its container; it never overflows the viewport.

## `/docs/install`

- Two paths: Docker (recommended) + `cargo install` (advanced).
- Each is a code block with a one-line copy button (Astro Shiki, compile-time highlighting, no client JS).
- **A master key is required** — the install copy calls out `DOCHUB_MASTER_KEY` (or a KMS config) prominently, because boot refuses to start without one. This is framed as a feature, not friction.
- "First-run checklist": visit `https://hub.your-server`, complete admin setup, create a project, upload a document, edit it, open its version history.

## `/docs/configuration`

- One big table of env vars: name, default, example, notes.
- Sections: Bind & origins · **Encryption (master key / KMS)** · Storage backend · Database · Sessions · Rate limits · Editor / collab (`DOCHUB_COLLAB_BACKEND_URL`) · Search/AI (`dochub-ai` provider) · SMTP.
- Per-backend storage subsection: filesystem · S3 · MinIO · R2 · B2 · in-memory (testing). Note that BYO credentials are themselves sealed.

## `/docs/architecture`

- Embedded SVG diagram (hand-authored): browser ↔ `hub.host` ↔ `usercontent-dochub.host` ↔ encryption layer ↔ Storage adapter ↔ {fs, S3, MinIO}, with the version + hash-chain engine and the Tantivy index called out.
- Encryption + envelope-key section (DEK wrapped by KEK/KMS; no plaintext at rest).
- Immutable version + hash-chain section (content_hash / prev_hash, restore-as-new, verify).
- Token model section.
- Each major section links back to the relevant `docs/research/` brief.

## `/docs/contributing`

- Repo layout (tree).
- Dev loop: `cargo run -p dochub` + `cd web && pnpm dev` + `cd marketing && pnpm dev`.
- PR conventions: small, focused, tests included (unit + integration + property for crypto/immutability + e2e for flows), docs updated in the same commit.
- The inviolable rules summarised + linked to `CLAUDE.md`.
- "Where to start" list of `good-first-issue` GitHub issues.

## `/screenshots`

- Gallery grid (2-col mobile, 3-col tablet, 4-col desktop) of every flagship surface.
- Each tile = `<Image>` + caption. Click → lightbox (Astro island, `client:visible`).
- Sections: Documents · Editor (Sheet) · Editor (Docs) · Version history · Sharing · Admin & compliance · Mobile. No media-library section — there is none.

## `/demo`

```
┌─ Slim header (sticky) ───────────────────────────────────────────────┐
│  [Logo] Doc-Hub · Demo                  Reset · Back to docs    │
└──────────────────────────────────────────────────────────────────────┘
┌─ Doc-Hub SPA (full viewport below header) ─────────────────────────────┐
│   (the actual SPA in demo mode with seeded documents + version chains)│
└──────────────────────────────────────────────────────────────────────┘
```

- `<head>` has `<meta name="robots" content="noindex, nofollow">`.
- The SPA bundle lives at `/demo-app/` (static, copied from `web/dist/` at build).
- The Astro `/demo` page is a thin host: header + `<iframe>` (or full-screen redirect) to `/demo-app/index.html`.
- "Reset" wipes demo `localStorage` keys (`dochub-current-project-v1`, demo seed flag) and reloads.
- "Back to docs" links to `/docs/install`.

## State checklists per page

- **Empty:** every list/section has real-content stub content; no "TBD".
- **Loading:** skeletons (commandment 6). Static pages have no loaders; only `/demo` (the SPA) does.
- **Error:** a 404'd screenshot falls back to its `alt` text in a styled box, not a broken-image icon.
- **No-JS:** every page renders; `/demo` shows "JavaScript required to run the demo" in `<noscript>`.
- **Reduced motion:** transitions ≥ 200 ms gated by `prefers-reduced-motion: no-preference`.

## Polish bar (10 commandments, marketing context)

1. **One primary action per screen** — hero's primary (filled) is Demo; Install is secondary (outline).
2. **Type carries hierarchy** — h1 4xl → h2 2xl → body lg → meta sm. No bold-as-hierarchy.
3. **Snap to 4/8 grid** — same spacing scale as the app.
4. **Concentric corners** — outer container rounding matches inner cards.
5. **Sub-100 ms** — theme toggle, nav drawer feel instant.
6. **Skeletons not spinners** — N/A on static pages.
7. **Keyboard is first-class** — nav fully tab-navigable; visible focus ring; skip-link works.
8. **`prefers-reduced-motion`** — honoured on hero fade, screenshot cycle, drawer slide.
9. **One icon family** — Lucide everywhere.
10. **Copy is warm, direct, sentence-case** — no all-caps headings, no `!`, no hype. State what it does and, honestly, what it doesn't.
