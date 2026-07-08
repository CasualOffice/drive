# UI System v3 — Neobrutalist (bold · crisp · high-contrast)

**Supersedes** `ui-system-glass.md` and `ui-vision-2026.md`. Decided after benchmarking GitDiagram (the polish reference). The muted soft-glass / amber / serif direction is **retired**. This is the authoritative design system.

Concept: **a bold, confident records tool.** High-contrast, crisp hard-edged depth, one vivid signal color, big bold type, generous clean layout, a little playful. Trust shown through clarity and confidence, not enterprise drab.

## 1. Non-negotiable rules (what makes it "neobrutalist-crisp")

1. **Hard borders.** Every card / input / button / panel has a solid **2px** border (`--border`), not a hairline. Borders are structural, not decorative.
2. **Hard offset shadows — no blur.** Depth = a solid offset block shadow: `4px 4px 0 0 var(--shadow-ink)` (cards/buttons at rest), `2px 2px 0 0` for small/subtle, `6px 6px 0 0` for raised/modals. **Zero Gaussian blur. No `backdrop-filter`. No glass.**
3. **Flat, high-contrast fills.** Solid fills only. Strong text/background contrast. No translucency, no gradients-as-surface (gradient allowed only for document *cover art*).
4. **One vivid signal — violet.** `--violet-500 #8B5CF6` for primary actions, active nav, focus, selection, verified/seal. Used confidently, not sparingly-timid.
5. **Big bold type.** One sans family (Inter / Geist-style), heavy display weights, large. Headlines have presence.
6. **Interactions are tactile.** Hover/press *move* the offset shadow (button presses "into" the page: translate + shrink shadow). Snappy, not floaty.

## 2. Color tokens (`tokens.css` — replace the glass/amber set)

```css
/* ---- Light ("Paper") — default, bold ---- */
:root {
  --bg-app:      #F4F1EA;   /* warm paper canvas */
  --bg-surface:  #FFFFFF;   /* cards, panels, inputs */
  --bg-sunken:   #ECE7DB;   /* wells, table header */
  --ink:         #14110C;   /* near-black text + borders */
  --ink-soft:    #55503f;   /* secondary text */
  --border:      #14110C;   /* 2px solid ink borders */
  --shadow-ink:  #14110C;   /* hard offset shadow color */

  --violet-100:  #EDE6FF;   /* violet tint fill */
  --violet-500:  #8B5CF6;   /* signal: primary/active/focus/verified */
  --violet-600:  #7C3AED;   /* pressed */
  --on-violet:   #FFFFFF;

  /* document-type cover accents (flat, bold) */
  --doc-docx: #2563EB; --doc-xlsx: #16A34A; --doc-pdf: #DC2626;
  --doc-md: #14110C;   --doc-img: #0891B2; --doc-folder: #8B5CF6;

  --ok: #16A34A; --warn: #D97706; --danger: #DC2626;
}
/* ---- Dark ("Ink") — first-class peer ---- */
[data-theme="dark"] {
  --bg-app:      #14121A;   /* plum-black canvas */
  --bg-surface:  #1E1B26;   /* cards/panels */
  --bg-sunken:   #100E15;
  --ink:         #F1EEF7;   /* text */
  --ink-soft:    #a49fb2;
  --border:      #34303F;   /* visible but not pure-black */
  --shadow-ink:  #05040A;   /* near-black hard shadow */
  --violet-100:  #2A2340;
  --violet-500:  #9B6CFF;   /* slightly lifted for dark */
  --violet-600:  #B18BFF;
  --on-violet:   #12101A;
}
```
Both themes strong; **light "Paper" is the default hero**, dark "Ink" a full peer. Text always ≥ WCAG AA on the solid fills (trivial here — everything is solid).

## 3. Depth, borders, radius, motion

```css
--radius:      10px;   /* cards/inputs/buttons — softly rounded, not pills, not sharp */
--radius-sm:   8px;
--border-w:    2px;
--shadow-sm:   2px 2px 0 0 var(--shadow-ink);
--shadow:      4px 4px 0 0 var(--shadow-ink);
--shadow-lg:   6px 6px 0 0 var(--shadow-ink);   /* modals, spotlight */
--ease:        cubic-bezier(0.2, 0, 0, 1);
--dur:         140ms;   /* snappy */
```
- **Rest:** `border: var(--border-w) solid var(--border); box-shadow: var(--shadow);`
- **Hover (raised elems):** shadow grows to `--shadow-lg`, translate `-1px,-1px`.
- **Press:** translate `2px,2px`, shadow → `--shadow-sm` (button sinks into its shadow). This tactile press is the signature interaction.
- **Reduced-motion:** keep the shadow states, drop the transform transition.

## 4. Type

```css
--font-sans: "Inter", "Geist", system-ui, sans-serif;   /* one family, heavy */
--font-mono: "JetBrains Mono", ui-monospace, monospace;  /* hashes/versions */
/* scale — bold + big */
--t-display: 700 44px/1.05 var(--font-sans);   /* page/hero titles, -0.02em */
--t-h1:      700 30px/1.15 var(--font-sans);
--t-h2:      650 20px/1.25 var(--font-sans);
--t-body:    450 14px/1.5  var(--font-sans);
--t-label:   600 12px/1 var(--font-sans);       /* uppercase eyebrows, +0.06em */
```
Remove Newsreader/serif. Headlines are heavy and large; eyebrow labels are uppercase tracked.

## 5. Components

- **Button (primary):** violet fill, 2px ink border, `--shadow`, press-sinks. Secondary: surface fill, ink border, same shadow. Ghost: no border/shadow until hover.
- **Card / doc tile:** surface fill, 2px border, `--shadow`, hover-raise. Document tiles get a bold flat **type-colored cover band** + big glyph + filename + a violet **`SEALED · v5`** chip (violet border + tint fill). No blank thumbnails, ever.
- **Input / search:** surface fill, 2px border, inset focus → 2px violet border + `--shadow-sm` violet.
- **Nav (sidebar):** flat; active row = violet-100 fill + 2px ink border + left violet marker; bold label.
- **Spotlight (⌘K):** a bordered solid modal, `--shadow-lg`, on a flat ink scrim (dimmed, **not** blurred). Solid surface, big bordered input, violet selection row. High contrast — never a pale dropdown.
- **Version history "Spine":** bordered version cards down a 2px ink rail with square nodes; head node violet-filled; on **Verify chain** the violet fills node-to-node up the rail and the row gets a `SEALED` chip. Hard-edged, tactile.
- **Chips/badges:** solid or tinted fill + 2px border; `SEALED`/verified = violet, tamper = danger, all icon+label.
- **Empty states:** a big bordered card with a bold glyph + one violet CTA — confident, not sad.

## 6. Signature moments

- **The Stamp** — on verify/seal, a violet `SEALED` chip *stamps* in (quick scale-overshoot + a 1px offset settle), like a physical stamp. Replaces the soft "specular sweep."
- **The Press** — every button/tile visibly sinks into its offset shadow on click. The whole UI feels physical.
- **The Ledger** — version history as a hard-edged bordered ledger with the violet verify-climb.

## 7. Rollout (screenshot-verified, serial)

1. **Foundation** — replace tokens.css (kill glass/aura/amber-primary/serif; add the above), swap `AmbientGround` for a flat canvas (optional subtle dotted-grid texture, no aura mesh).
2. **Sign-in + Shell** (sidebar/topbar) — bold bordered chrome.
3. **Vault** — bordered doc tiles + covers + SEALED chips + press.
4. **Spotlight** — solid bordered modal.
5. **Version history** — the bordered Ledger + violet climb.
6. **Editor / settings / dialogs** — carry the system.

Each step: build → screenshot (light + dark) → critique against this doc → fix, before merge. Keep all e2e testids.
