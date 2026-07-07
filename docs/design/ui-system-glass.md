# UI System v2 — Glass / Apple-grade finish

Elevation of [`ui-system.md`](./ui-system.md) from flat-hairline to **premium, Apple-product-grade glass**. This doc **supersedes ui-system.md's material/elevation/motion sections**; everything else in ui-system.md (density scale, type, the ink/paper + amber identity, the compliance/security affordances, the empty-state anatomy, accessibility) **still holds**. This is a *material and finish* change, not a density or identity change.

> North star: it should feel like macOS/iOS — frosted vibrancy panels floating over an ambient ground, a Spotlight-class command surface, fluid spring motion, and pixel-perfect finish. Dense and precise, but *luxurious*.

## 1. Principles (supersede the old "flat, hairline-first, minimal shadow")

1. **Materials, not fills.** Surfaces are translucent frosted glass over an ambient ground, not opaque flat panels. Depth comes from blur + light, not borders.
2. **Layered depth.** A clear z-order of materials (ground → thick → regular → thin → ultra-thin) reads as physical planes.
3. **Light models the surface.** Every raised material has a 1px top-edge highlight (light catching the bevel) and a soft ambient shadow below.
4. **Motion is spring, not linear.** Panels scale+fade in on a gentle spring; the command surface expands like Spotlight. All opt-out under `prefers-reduced-motion`.
5. **Restraint at density.** Glass is the *chrome* (shell, palette, panels, overlays, badges). Dense data rows (the vault table, version chain, audit) stay crisp and legible on a near-solid material — glass never costs readability.
6. **Still ink + paper + amber.** The palette and the single amber accent are unchanged; they now live *in glass*. Amber gains a soft glow when it means "attention/live".

## 2. Material tokens (add to `tokens.css`)

Backdrop blur requires `backdrop-filter` (+ `-webkit-`). Provide a **`@supports not (backdrop-filter: blur())` fallback** to near-opaque solids (below), and honor `prefers-reduced-transparency` by dropping to solids.

```css
:root {
  /* Ambient ground the glass floats on (dark-first premium; light variant below). */
  --ground: #0e0e12;                         /* near-black, faint blue */
  --ground-aurora-1: rgba(183,121,31,0.10);  /* amber bloom */
  --ground-aurora-2: rgba(70,70,90,0.14);    /* cool bloom */

  /* Material hierarchy (translucency + blur). alpha over the ground. */
  --mat-ultrathin: rgba(28,28,34,0.44);
  --mat-thin:      rgba(28,28,34,0.60);
  --mat-regular:   rgba(24,24,30,0.72);
  --mat-thick:     rgba(20,20,26,0.86);
  --blur-mat: 20px;      /* regular panels */
  --blur-chrome: 30px;   /* sidebar/top bar */
  --blur-overlay: 40px;  /* command palette / dialogs */
  --saturate: 180%;

  /* Edge light + ambient shadow that sell "physical glass". */
  --edge-hi: inset 0 1px 0 rgba(255,255,255,0.08);
  --edge-lo: inset 0 -1px 0 rgba(0,0,0,0.30);
  --shadow-float: 0 8px 30px rgba(0,0,0,0.38), 0 2px 8px rgba(0,0,0,0.28);
  --shadow-overlay: 0 24px 70px rgba(0,0,0,0.50);
  --hairline-glass: 1px solid rgba(255,255,255,0.10);

  /* Amber, in glass. */
  --accent-glow: 0 0 0 1px rgba(183,121,31,0.5), 0 0 16px rgba(183,121,31,0.35);
}

.glass {                      /* the base material mixin */
  background: var(--mat-regular);
  backdrop-filter: blur(var(--blur-mat)) saturate(var(--saturate));
  -webkit-backdrop-filter: blur(var(--blur-mat)) saturate(var(--saturate));
  border: var(--hairline-glass);
  box-shadow: var(--edge-hi), var(--shadow-float);
  border-radius: var(--radius-lg);
}
@supports not (backdrop-filter: blur(1px)) {
  .glass { background: #1b1b21; }         /* opaque fallback, same geometry */
}
@media (prefers-reduced-transparency: reduce) {
  .glass { background: #1b1b21; backdrop-filter: none; }
}
```

- **Light theme** = "frosted paper": ground `#eceae3`, materials `rgba(255,255,255,0.55–0.85)` + blur, edge-hi `rgba(255,255,255,0.6)`, softer shadows. Same token names, swapped values under `[data-theme='light']`. Default theme decision unchanged from ui-system.md, but **dark-glass is the hero** (it's where vibrancy sings).
- Text on glass must still clear **WCAG AA** — measure on the *fallback solid* (worst case), never on the translucent value. Body text sits on `--mat-thick`/near-solid rows.

## 3. Immersive ground

- A fixed, GPU-cheap **ambient background** behind the whole app: `--ground` + two large, slow-drifting radial blooms (`--ground-aurora-1/2`) — an aurora mesh, ~30s drift, `will-change: transform`, paused under reduced-motion. The glass chrome blurs it, giving real vibrancy (color bleeds through).
- Keep it subtle — this is a records vault, not a screensaver. The blooms are ~8–14% alpha.

## 4. Depth map (which material each surface uses)

| Surface | Material | Blur |
|---|---|---|
| Ambient ground | `--ground` + aurora | — |
| Sidebar, top bar (chrome) | `--mat-thin` | `--blur-chrome` |
| Vault table / content pane | near-solid (`--mat-thick`) for legibility | `--blur-mat` |
| Detail/version/audit panels | `--mat-regular` | `--blur-mat` |
| **Command palette (Spotlight)**, dialogs, menus, toasts | `--mat-thick` + `--shadow-overlay` | `--blur-overlay` |
| Badges/chips (encryption, version, status) | `--mat-thin` pill + edge-hi | small |

Rows lift on hover with a whisper of elevation (shadow + 1px), not a color swap.

## 5. Spotlight — the command surface

⌘-K becomes **Spotlight-class**:
- Centered, ~640px, `--mat-thick` glass, `--blur-overlay`, `--shadow-overlay`, `--radius-xl`, edge-hi. Appears on a **spring** (scale 0.96→1 + fade, ~180ms) with a dimmed+blurred scrim behind.
- A large search field (no visible box — a big translucent input), grouped results (registry/security-aware: documents, versions, actions, "verify chain"), mono `kbd` chips, live highlight. Selection is a soft amber-wash row with `--accent-glow` on the leading icon.
- Fully keyboard-driven; `Esc`/scrim-click dismiss; reduced-motion → instant.

## 6. Motion tokens (supersede the old fast/linear set)

```css
--ease-spring: linear(0, 0.35 7%, 0.9 18%, 1.05 28%, 1 38%, 1); /* gentle overshoot */
--dur-micro: 120ms;  --dur-panel: 220ms;  --dur-overlay: 260ms;
```
- Panels/overlays: scale+fade on `--ease-spring`. Hovers: `--dur-micro`. Route/detail transitions: cross-fade + subtle depth (scale 0.99). Live signals (tamper alarm, presence) breathe. **All** wrapped in `@media (prefers-reduced-motion: reduce)` → no transform/opacity animation.

## 7. Component finish deltas (from the flat M1–M5)

- **Shell:** sidebar + top bar become `--mat-thin` glass over the ambient ground; the "Encrypted at rest" footer chip is a glowing glass pill.
- **Vault table:** header is glass; rows on a legible near-solid; hover = soft lift; selection = amber-wash + edge-hi.
- **Version-history:** the hash-chain timeline gets connective depth (glass nodes, a subtle spine); the **tamper alarm** is a persistent amber-glow glass banner (`role="alert"`, still icon+label, never color-only).
- **Dialogs/menus/toasts:** all `--blur-overlay` glass with the spring entrance.
- **Empty states:** the registry-stack motif sits on a faint glass card with the ambient ground behind.
- **Badges:** encryption/version/verify chips become frosted pills with edge-hi; verified = soft green tint, tamper = `--accent-glow` amber.

## 8. Accessibility (glass-specific — extends ui-system.md §9)

- **Contrast measured on the fallback solid** (the worst case), always ≥ AA for text; amber text still uses `--amber-700`.
- Honor **`prefers-reduced-transparency`** and **`prefers-reduced-motion`** → solids + no motion, no loss of function or meaning.
- Focus-visible: a 2px amber ring **plus** `--accent-glow` so it reads on glass.
- Never encode state in translucency alone — pair with icon + label as today.

## 9. Rollout (a re-skin, not a rebuild)

Applied as **UI M6 — glass finish**, surface by surface, on top of M1–M5 (which already have the structure + tokens + testids — keep them, only change materials/motion so e2e stays green):
1. Tokens + ambient ground + the `.glass` material system in `tokens.css`.
2. Shell (sidebar/top bar) + Spotlight command palette.
3. Panels (detail/version/audit) + dialogs/menus/toasts.
4. Vault table + badges + empty states finish pass.
5. Light-theme frosted variant + reduced-transparency/motion QA.

Acceptance: it reads as a polished Apple-grade product; density + all testids/e2e preserved; AA on fallback solids; reduced-transparency/motion fully functional.
