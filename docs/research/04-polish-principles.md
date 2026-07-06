# 04 — Polish Principles for Doc-Hub

> **Superseded by [`docs/design/ui-system.md`](../design/ui-system.md).**
> That document is the canonical, implementable UI system — tokens, type scale, density targets, components, compliance patterns, accessibility. Where this brief and the UI system conflict, **the UI system wins.** Do not copy tokens or the "10 commandments" out of this file; read them there.

**What this file is now:** the research trail behind the quality bar — the macOS-tier reference apps (Things 3, Linear, Raycast, Notion, Arc, Figma), the perceived-speed work, and the anti-patterns. Kept for provenance. It is *not* the spec.

**Audience:** the frontend engineer building Doc-Hub's web UI.
**Out of scope:** Doc-Hub's information architecture; and — as of the UI system — the token set and the commandments list, both of which moved.

---

## What changed, and why

The original brief translated a generic "macOS-app polish" bar into a blue-accent, spacious, breathing-room token set. Deriving the system from `logo.svg` and grounding it in the product's actual job (an encrypted, tamper-evident **records registry**, not a Drive) forced three corrections. These supersede the old tokens and the old 10 commandments:

1. **Dense, not spacious.** Doc-Hub is a records tool. Rows are **32px** (28px compact, 40px max), body text is **13px**, no in-app spacing exceeds 32px. The old "strip dividers, use 24px space" advice is reversed: hairline rules and tight rhythm carry a dense table. See ui-system §1, §4.

2. **Logo-derived monochrome + amber, not neutral-grey + blue.** The palette comes straight from the logo: a warm ink→paper gray ramp with a single chroma — **amber `#B7791F`** — used for status/attention only. **Light (paper) is the default theme**, mirroring the logo's ground. The old `#0A84FF` macOS blue, `slate/zinc` greys, and vibrancy/`backdrop-filter` guidance are dropped. Amber never encodes meaning alone: every amber (and every verified/danger) signal pairs with a Lucide icon **and** a text label (WCAG 1.4.1). See ui-system §2.

3. **Compliance-forward.** Trust is shown, not stated. Version chains, hash verification, encryption badges, legal-hold/retention banners, and provenance cards are **first-class, load-bearing components** with every state designed — not settings-panel afterthoughts. Tamper is a persistent alarm (icon + label + remediation), never a silent red tint. Immutable actions ("restore", "delete", "new version") read as additive. See ui-system §7, §8.

Unchanged and carried forward into the UI system: one primary action per surface, type-carries-hierarchy, the 4px grid + concentric corners, sub-100ms/optimistic UI, skeletons-over-spinners, keyboard-first with advertised shortcuts, `prefers-reduced-motion` honored everywhere, one icon family (Lucide, 1.5px stroke), terse present-tense sentence-case copy. The refinement is tone: copy leans **Linear-terse**, not warm-Apple, and never "Oops".

---

## Reference apps — what to study

The research value of this file. Study behaviour and rhythm, not palette.

- **Linear** — density done right, Cmd-K, optimistic UI, sync engine, keyboard-as-philosophy. The closest analogue to Doc-Hub's dense table + instant-write feel. Read the [performance.dev breakdown](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown) twice.
- **Raycast** — instant search, "do nothing until typed" command palette, keyword discovery.
- **Things 3** — restraint, type hierarchy, a single persistent affordance carrying the input model.
- **Fantastical** — "information-dense without feeling cluttered"; coordinated views over one dataset.
- **Arc** — the sidebar as where state and identity live, not a nav graveyard.
- **Figma / Sketch desktop** — file-browser and asset-panel polish; the most directly relevant list/registry surfaces.
- **Notion / Bear / Craft** — spacious content surfaces; relevant only for Doc-Hub's *detail/preview* pane, not the list.

## Perceived speed (still load-bearing)

The most important behavioural target, carried into ui-system §5/§7:

- **The 100ms rule.** Direct manipulation <100ms; navigation <400ms (Doherty). Below ~100ms cause and effect feel simultaneous.
- **Optimistic UI** for every plausibly-safe write — write local, reflect in UI, queue for server, reconcile/rollback on failure (Linear's shape). Immutable writes (new version, sign) still confirm.
- **Skeletons, not spinners** for content (~20–30% perceived speedup). Spinners only for short finite system tasks — verify-chain per node, sign, export, upload.
- **Pre-fetch on hover; cache aggressively, revalidate.** Boot from cache.

## Anti-patterns to avoid

Carried forward, with product-specific edges:

- **Tamper as a silent color swap.** A broken hash chain or failed verification must be a persistent, icon+label alert with remediation — never a red tint. (Product-specific; the sharpest rule.)
- **Destructive-sounding immutable actions.** "Delete"/"restore" copy that implies erasure contradicts the append-only reality. Frame additively.
- **Color-only meaning.** Amber/verified/danger without an icon and label.
- **Marketing whitespace / hero layouts / ≥48px rows.** Layout smell on a records tool.
- **Gradient primary buttons, heavy drop shadows (`/0.5`), text drop-shadow, neon focus rings, omnipresent glassmorphism, animating everything.**
- **Multiple primary buttons; modals that open modals; custom scrollbars that hide; dark mode as inverted light (use warm-dark, ink `#16161A` as darkest surface, never `#000`).**

## Libraries (unchanged)

Radix primitives (foundation) · cmdk (command palette) · sonner (toasts) · vaul (drawers) · lucide-react (icons) · Motion/Framer Motion (motion) · React + Vite + `@schnsrw/design-system` tokens per the locked stack.

---

*Historical brief. For anything implementable — tokens, scale, components, states — go to [`docs/design/ui-system.md`](../design/ui-system.md).*
