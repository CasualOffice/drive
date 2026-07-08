# Doc-Hub UI Vision 2026 — "Ink under Glass, Sealed in Amber"

Design-language reset for the Doc-Hub web UI. Supersedes the flat/monochrome direction that
the current build (`web/src/styles/tokens.css`) renders. This is the opinionated target; the
phased plan in §8 says exactly how we get there and how each step is visually verified.

> Status: design direction, pre-implementation. Concrete enough to build against — every value
> here is copy-pasteable. Where it conflicts with `ui-system.md`/`tokens.css`, **this wins** and
> those get repointed in P0.

---

## 0. Executive summary (react to this before we build)

**Concept line:**
> **A reading room for permanent records** — warm archival paper and near-black registry ink,
> floated under real glass, lit by a single amber light that means *verified*. Trust you can see.

The current UI failed because it is a monochrome admin table: the amber (the brand's whole
emotional core) barely appears, the "glass/aurora" system is painted over by opaque panes and is
sub-perceptual anyway, documents have no visual identity, and there is no focal drama on a product
whose entire promise is *tamper-evident permanence*. We fix that not by adding chrome but by
spending a tight **delight budget** on three signature moments and by making depth, chroma, and
material actually reach the screen.

### Top 8 decisions
1. **Dark-first "Registry" is the flagship surface; warm-paper "Reading Room" is its first-class
   peer.** Dark near-black (`#0B0B0F`) is where the amber seal and the mesh floor sing (Linear /
   Vercel / Raycast / Arc all default dark for exactly this reason). Light stays the brand ground.
2. **Amber becomes a real signal color, not a muddy brown.** Retune from `#B7791F` to an OKLCH-even
   ramp with a bright **signal amber `#F2A324`** reserved *only* for verified/seal/CTA/focus/active —
   never decoration (Linear's "accent as a flashlight" law).
3. **A live, actually-visible atmospheric floor ("the Aura").** Ink→slate→deep-amber mesh at real
   chroma and coverage behind translucent chrome — the single "wow surface" per view. Fixes defects
   #1 and #2 (occluded + sub-threshold ground).
4. **Every document gets an identity.** Kill the blank 96px placeholder thumbs; per-type gradient
   cover fields + real thumbnails + one colored glyph. Reintroduce file-type chroma on the vault
   surface only.
5. **Real modeled depth.** Layered, ink-tinted shadows sharing one light source + a top rim-light
   ("carved" Geist/Stripe feel), plus hover *lift*, replacing the flat color-swap hovers.
6. **An editorial voice in the type.** Add a **serif display face** (record/ledger gravity) for
   hero titles + big trust numerals; keep Inter for UI/body, JetBrains Mono for hashes/audit. Open
   the scale up to 40/56/80 — the current 28px ceiling is why hierarchy reads compressed.
7. **Glass is earned, not sprinkled.** ≤3 glass elements per viewport (command bar, floating editor
   toolbar, verification popover); blur 16–20px + saturate 180% + bright 1px edge; everything else
   is flat + hairline so glass reads as *special*.
8. **Trust is shown, not told.** Ambient integrity strip ("Sealed · v12 · SHA-256 a1b2…" in mono),
   a glowing hash-chain spine, specific claims + one small icon at the peak-anxiety moment — no
   stock shield graphics, no enterprise banners.

### The 3 signature moments
- **The Seal** — when a document's hash validates, an amber specular sweep crosses a glass seal
  badge and settles into a quiet mono caption. The one place we spend overshoot easing. The
  emotional payoff of permanence, in ~600ms.
- **The Spine** — the hash-chain / version history rendered as a living vertical ledger: hairline
  axis, mono timestamps, status nodes; on "Verify chain" the amber travels node-to-node up the
  spine and the whole strip settles into a verified glow. Trust as a visible, physical structure.
- **The Aura** — the low-saturation ink+amber mesh floor breathing behind the glass chrome; the
  material that makes the whole app feel lit and premium instead of drawn on graph paper.

---

## 1. Concept & principles

**The feeling:** you are standing in a modern archive — quiet, warm, permanent — and there is a
single amber lamp that turns on when something is *proven true*. Not a bank vault (cold), not an
admin panel (dead). A **reading room for records that can never be quietly altered.**

**Principles**
1. **Restraint is the luxury.** One accent, one glass moment, one hero gradient per view. The
   discipline *is* the premium signal (Linear, Geist). Amber earns its appearances.
2. **Trust is a material, not a badge.** Permanence is felt in depth, weight, monospace precision,
   and the seal's light — never asserted with shield clipart or banners.
3. **Depth from light, not lines.** Model a single light source: layered tinted shadows, rim-light,
   elevation-by-opacity. Hairlines separate; light lifts.
4. **Speed is design.** Sub-100ms response, optimistic mutation + undo, skeletons over spinners,
   command palette over a local index. Permanence should also feel *instant*.
5. **Density with air.** Data-dense like Attio/Linear, but every hero surface breathes. Never a wall
   of 13px grey.

---

## 2. Palette + material story

### 2.1 Foundation — two grounds, one system

Both themes are first-class. Model everything in OKLCH so equal-lightness hues read equally light
(Linear's LCH migration) and the amber holds across both.

**Registry (dark, flagship)** — deeper than today's `#131316`; aim for premium near-black:
```
--bg-canvas   #0B0B0F   /* app ground (was #131316) */
--bg-surface  #111116   /* panels, tables */
--bg-raised   #17171E   /* popovers, cards lifted */
--bg-sunken   #08080B   /* wells, hash blocks, inputs */
/* elevation by ~2% steps, not shadows, on flat panels */
--layer-1 #111116  --layer-2 #16161C  --layer-3 #1B1B22  --layer-4 #202028
--border-hair   rgba(245,243,238,0.09)
--border-strong rgba(245,243,238,0.16)
--fg-default #F2F0EA  --fg-muted #A9A7B0  --fg-subtle #6E6D77   /* never pure #fff on #000 */
```

**Reading Room (light, brand ground)** — keep warm paper but deepen separation (defect #4):
```
--bg-canvas   #F3F0E9   /* warm paper (slightly deeper than #F5F3EE) */
--bg-surface  #FBFAF6   /* cards */
--bg-raised   #FFFFFF
--bg-sunken   #ECE9E1   /* deeper well — real card-vs-ground separation */
--border-hair   rgba(22,22,26,0.09)
--border-strong rgba(22,22,26,0.15)
--fg-default #16161A  --fg-muted #45454B  --fg-subtle #8A8A92
```

### 2.2 Amber — the single signal color (retuned)

The current `#B7791F` is a muddy tobacco brown; it disappears. Replace with an OKLCH-even ramp
built around a **bright signal amber**. Amber = verified / sealed / active / focus / primary CTA
**only** (the restraint law).

```
--amber-50   #FEF6E6
--amber-100  #FBE8C2
--amber-200  #F8D48C
--amber-300  #F5C05A
--amber-400  #F2A324   /* SIGNAL — seal, focus ring, active, CTA fill (dark) */
--amber-500  #E08D12   /* CTA fill (light), hover */
--amber-600  #C0760D
--amber-700  #9A5D0C   /* amber TEXT on paper — AA 4.9:1 */
--amber-glow-1  rgba(242,163,36,0.55)   /* focus / seal core */
--amber-glow-2  rgba(242,163,36,0.18)   /* wash, selection, aura bloom */
--amber-glow-3  rgba(242,163,36,0.07)   /* ambient edge */
```
OKLCH anchor: `--amber-400 ≈ oklch(76% 0.148 72)`. Focus ring = `0 0 0 2px surface, 0 0 0 4px
var(--amber-glow-1)`.

### 2.3 Status — resaturate (defect #12)

Muted-to-grey killed the compliance signal. Give status real chroma while staying archival:
```
--status-verified  #35A66B  (text-700 #2F8F5D on light)   /* chain intact — green */
--status-attention #F2A324  (text-700 #9A5D0C)            /* hold / pending — amber */
--status-danger    #E0574A  (text-700 #B23227)            /* tamper / break — brick-red */
--status-info      #6E8BD6  (text-700 #3E5AA8)            /* neutral informational — slate-blue */
```
Green = verified/success, red = integrity failure only, slate-blue = neutral metadata, amber =
attention/held (trust color psychology). Status pills: soft tinted bg + bold text, not loud badges.

### 2.4 The Aura — the atmospheric floor (fixes the dullness)

The single biggest lever. A real, visible mesh gradient behind translucent chrome. Two tiers:

**Static CSS mesh (baseline, ships first, reduced-motion fallback).** Real chroma, wide coverage —
alpha ~0.18–0.28, not today's 0.08–0.10 whisper:
```css
/* Registry (dark) ground */
.aura-dark{
  background:
    radial-gradient(70% 55% at 18% 12%, rgba(242,163,36,0.16) 0%, transparent 60%),
    radial-gradient(60% 60% at 85% 8%,  rgba(96,110,170,0.14) 0%, transparent 55%),
    radial-gradient(80% 70% at 60% 100%,rgba(242,163,36,0.10) 0%, transparent 60%),
    #0B0B0F;
}
/* Reading Room (light) ground — warmer, subtler but still above threshold */
.aura-light{
  background:
    radial-gradient(65% 55% at 20% 10%, rgba(242,163,36,0.22) 0%, transparent 60%),
    radial-gradient(55% 55% at 88% 6%,  rgba(120,130,180,0.12) 0%, transparent 55%),
    radial-gradient(80% 70% at 50% 100%,rgba(242,163,36,0.10) 0%, transparent 62%),
    #F3F0E9;
}
```

**WebGL mesh (progressive enhancement, hero/auth/empty/vault-header only).** Stripe `minigl`-style
(~10kb), 3–4 colors from CSS vars animating via noise, GPU-only, very slow drift (period ~18–24s).
Keep **low-saturation and ink-adjacent** — blend `#0B0B0F → #1B2233(slate) → #7A5410(deep amber) →
#F2A324` at low opacity. Never animate on data-dense surfaces.

**The non-negotiable that was broken before (defect #1):** content panes must be *translucent or
transparent* so the Aura shows through. `Files.tsx` pane, `Shell.tsx` CenteredPane, and the sidebar
cannot paint opaque `--bg-canvas` on top of the ground. Panes become
`background: color-mix(in oklab, var(--bg-surface) 82%, transparent)` with the Aura fixed behind.

### 2.5 Glass — earned material (≤3 per viewport)

Only the command bar, the floating editor toolbar, and verification/seal popovers. Everything else
is flat + hairline so glass reads as special (anti-slop guardrail).

```css
.glass{
  background: rgba(255,255,255,0.10);            /* dark UI: rgba(22,22,28,0.44) */
  -webkit-backdrop-filter: blur(18px) saturate(180%);
  backdrop-filter: blur(18px) saturate(180%);
  border: 1px solid rgba(255,255,255,0.16);      /* bright 1px edge = the "liquid" tell */
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(11,11,15,0.28),
              inset 0 1px 0 rgba(255,255,255,0.30);   /* top edge-light */
}
@supports not (backdrop-filter: blur(1px)){ .glass{ background: rgba(20,20,26,0.92);} }
@media (prefers-reduced-transparency: reduce){ .glass{ background:#14141A; backdrop-filter:none;} }
```
Rules: never animate `backdrop-filter`; body text sits on ≥0.20-opacity/solid; glass only over the
Aura (over flat grey it's a smudge). Optional **specular-edge upgrade** (nav/seal only) via a
pseudo-element with directional inset highlights — see §6 The Seal.

### 2.6 Depth — layered ink-tinted shadows + rim-light (defect #5)

Single flat shadows look fake. Layered shadows sharing one light-source ratio, tinted with the
ground's hue (Comeau). Ship as `--elevation-{0..3}`; pair with a top rim-light for the carved feel.

```
--elevation-1: 0.5px 1px 1px hsl(250 20% 12% / .12);
--elevation-2: 1px 2px 2px hsl(250 20% 12% / .10),
               2px 4px 4px hsl(250 20% 12% / .10),
               3px 6px 6px hsl(250 20% 12% / .10);
--elevation-3: 1px 2px 2px  hsl(250 20% 12% / .08),
               2px 4px 4px  hsl(250 20% 12% / .08),
               4px 8px 8px  hsl(250 20% 12% / .08),
               8px 16px 16px hsl(250 20% 12% / .08),
               16px 32px 32px hsl(250 20% 12% / .08);
--rim-light: inset 0 1px 0 rgba(255,255,255,0.55);   /* light theme; .12 on dark */
```
On dark, elevation is primarily by surface-opacity step (§2.1) + a subtler shadow. Cards **lift** on
hover (`translateY(-2px)` + step to `--elevation-2`), never just swap background.

---

## 3. Type system

**Families**
- **Display (editorial voice):** a refined contemporary serif — **Newsreader** (or Instrument
  Serif) — for hero titles, empty-state headlines, and big trust numerals. This is the
  "record/ledger/archive" gravity that separates us from every grey SaaS table. Display-only; never
  body.
- **UI / body:** **Inter** (keep) — 400/450/500/600.
- **Mono:** **JetBrains Mono** (keep) — hashes, IDs, audit timestamps, version tags. Mono = the
  tamper-evident/technical signal.

**Scale (px / line-height / tracking)** — open it up past today's 28px ceiling:
```
display-xl  80 / 1.04 / -0.03em   (serif)   hero numerals, splash
display-lg  56 / 1.08 / -0.025em  (serif)   auth / empty-state headline
display-md  40 / 1.12 / -0.02em   (serif)   surface hero title
headline    28 / 1.20 / -0.015em  (Inter 600)
title       22 / 1.28 / -0.01em   (Inter 600)  card / panel title
subhead     18 / 1.40 / -0.005em  (Inter 500)
body-lg     16 / 1.50 / normal    (Inter 450)
body        14 / 1.50 / normal    (Inter 450)  ← raise default UI text from 13 to 14
meta        12 / 1.40 / normal    (Inter 500)
eyebrow     12 / 1.30 / +0.06em   (Inter 600, UPPERCASE)  classification / section labels
mono        13 / 1.50 / normal    (JetBrains)  hashes, audit, version
mono-sm     11 / 1.45 / normal    (JetBrains)  inline IDs
```
The premium tell: negative tracking scales *with* size. Big trust numbers (version count, doc
count) render in serif display for editorial weight.

---

## 4. Motion system

**Golden rules:** UI motion < 300ms; animate **only `transform` + `opacity`** (never
width/height/margin/padding — defect #11 fix); default ease-out for enter/exit; never built-in
`ease-in`; enter from `scale(0.96)+opacity:0`, never `scale(0)`; honor `prefers-reduced-motion`
(keep opacity/color, drop transform).

**Easings (drop-in tokens):**
```
--ease-out    cubic-bezier(0.23, 1, 0.32, 1)     /* most UI enter */
--ease-exit   cubic-bezier(0.4, 0, 1, 1)          /* dismiss */
--ease-inout  cubic-bezier(0.77, 0, 0.175, 1)     /* morph / move */
--ease-sheet  cubic-bezier(0.32, 0.72, 0, 1)      /* drawers, detail morph */
--ease-seal   cubic-bezier(0.34, 1.56, 0.64, 1)   /* OVERSHOOT — verification success ONLY */
```

**Durations:**
```
--dur-press   120ms   button :active scale(0.97)
--dur-fast    160ms   tooltip / hover lift / row fill
--dur-base    220ms   dropdown / popover / tab
--dur-sheet   340ms   drawer / detail morph
--dur-seal    600ms   the Seal celebration (once, spring)
```

**Springs** (framer-motion / Web Animations): spatial transitions `{ type:"spring", stiffness:220,
damping:26 }` (≈ Arc `response 0.3, damping 0.7`); the Seal `{ type:"spring", duration:0.6,
bounce:0.18 }`. Bounce ≤0.2 anywhere — this is a compliance tool.

**What animates**
- Cards/rows **lift** (translateY, shadow step) on hover — `--dur-fast`, `--ease-out`.
- Row action → item slides out + neighbors slide up to fill the gap (Superhuman archive), 160ms.
- Detail: card **morphs from its own position** into the detail panel (spatial continuity),
  `--ease-sheet`, `--dur-sheet`.
- Command palette / keyboard actions appear **instantly, no fade** (Rauno: suppress animation on
  high-frequency actions).
- List entrance: stagger 30–60ms; never block input during stagger.
- Destructive/irreversible: **hold-to-confirm** — a `clip-path` fill over ~1.6s `linear`, resets in
  200ms `ease-out`; trigger on release. (Fits the append-only registry ethos.)

---

## 5. Layout & IA per surface

Global shell = Linear's **inverted-L**: persistent left rail + slim top bar wrapping a content
region, over the fixed Aura. Rail 240px / collapses to 56px with hover-peek. Kill the black demo
banner (defect #8) and rebalance the top bar (defect #9): left = breadcrumb + surface title, center
= command trigger, right = search + identity.

### 5.1 Shell
```
┌──────────────────────────────────────────────────────────────────────┐
│  ● Doc-Hub   Projects ▸ Compliance ▸ Q3         ⌘K Search…      ◐  ⧉  │ ← slim glass top bar (56px)
├──────────┬───────────────────────────────────────────────────────────┤
│ RAIL     │                                                            │
│ ▸ Home   │   [ CONTENT — translucent pane over the Aura ]             │
│ ▸ Vault  │                                                            │
│ ▸ Sealed │                                                            │
│ ▸ Audit  │                                                            │
│ · · · ·  │                                                            │
│ 🔒 AES256│                                                            │  ← quiet integrity chip
└──────────┴───────────────────────────────────────────────────────────┘
        the Aura (fixed, z-1) glows through the translucent panes
```

### 5.2 Vault (the hero — fixes defects #3, #4, #10)
Switchable **Table / Grid / Timeline** over one document set (Attio views). Grid is the identity
moment.
```
┌─ MY DRIVE ────────────────────────────  [Table][Grid][Timeline]  + New ┐
│  8 documents · 3 sealed        (display-md serif title + serif numeral) │
│                                                                         │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐            │
│  │▒▒gradient▒│  │▒▒gradient▒│  │  cover    │  │▒▒gradient▒│            │  ← per-type gradient
│  │  cover    │  │  cover    │  │  thumb    │  │  cover    │            │    field + real thumb
│  ├───────────┤  ├───────────┤  ├───────────┤  ├───────────┤            │
│  │📄 Contract│  │📊 Q3 Sheet│  │📕 Policy  │  │📝 Notes   │            │
│  │ SEALED ·v4│  │ DRAFT     │  │ SEALED·v9 │  │ REVIEW    │            │  ← pastel status pill
│  │ a1b2·mono │  │ —         │  │ 8f3c·mono │  │ —         │            │  ← mono hash caption
│  └─══════════┘  └───────────┘  └─══════════┘  └───────────┘            │
│    ↑ 3px amber left rule + hairline gradient bar = SEALED               │
└─────────────────────────────────────────────────────────────────────────┘
```
- **Document identity:** each type gets a subtle gradient cover field (PDF warm-red, Sheet green,
  Doc slate-blue, Markdown amber, etc. — resaturate `--ic-*`) + real thumbnail + one colored glyph.
- **Sealed** documents carry a **3px amber left rule** + hairline gradient top-bar (Arc space-badge
  analog) — verification is spatial identity, not a loud badge.
- Vary card weight by status: a freshly-sealed doc lifts one elevation level. No identical-grid
  monotony.

### 5.3 Editor (documents-only → lean into focus)
Floating **pill toolbar** (glass) that collapses to near-nothing; Focus/Typewriter modes hide rail
+ chrome. **Ambient integrity strip** docked to the header — trust as constant quiet reassurance:
```
┌────────────────────────────────────────────────────────────────────────┐
│  ‹ Contract.md      🔒 Sealed · v4 · SHA-256 a1b2c3…9f  · 3m ago   ⌘S   │ ← integrity strip (mono)
├────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│              [ typographically-beautiful document canvas ]              │
│                    ·········· floating glass pill ··········            │
│                    │  B  I  ⌘  ¶  ⟨/⟩  ⌗  │                             │
└────────────────────────────────────────────────────────────────────────┘
```

### 5.4 Version history — **The Spine** (signature)
Hybrid timeline (event + status/ownership) as a living vertical ledger. Four-part anatomy per
entry: axis · node · content (actor + action + metadata) · mono time label.
```
      THE SPINE                                    [ Verify chain ]  ← amber CTA
   ●───┐  v12  Sealed by Ana        SHA a1b2…9f   2m ago            │ node pulses amber
   │   │       tamper-evident                                       │ as verify travels ↑
   ●───┤  v11  Edited by Sam        SHA 7c3e…41   1h ago            │
   │   │                                                            │
   ●───┤  v10  Restored-as-new      SHA 4d90…a2   yesterday         │
   │   │                                                            │
   ○···┘  …    (progressive disclosure, paginated)                  │
   ══════════════════════════════════  chain intact ✓ (green)  ═════┘  ← settles to verified glow
```
Hairline axis, small status-colored nodes, mono timestamps, green "chain intact" / red on break
(never color-only — always icon + text).

### 5.5 Spotlight (⌘K command bar)
Glass, spring-open at `top: 20%`, `min(640px, 90vw)`, searches a **local index** (instant, no
server round-trip), **shortcut shown next to every command** (teaches itself → Superhuman). Per-row
ActionPanel (Raycast) so nothing needs the mouse.
```
      ┌───────────────────────────────────────────────┐  ← glass, blur 18px
      │ ⌘  Seal current document…              ⌘⇧S     │
      │    Verify chain                        ⌘⇧V     │
      │    Open Contract.md                    ↵       │
      │    New document                        C       │
      └───────────────────────────────────────────────┘
```

---

## 6. Making trust/compliance feel premium

The rule (biggest lever from "generic" to "crafted"): **plain text + one small icon + a *specific*
claim beats any stock seal graphic** (A/B: specific > generic 2–3×). Trust cues appear at the
**peak-anxiety moment** (seal / verify / share), the way fintech puts security cues at the payment
field.

- **Ambient integrity strip** everywhere a document lives: `Tamper-evident · SHA-256 · sealed 3m
  ago` in mono + one amber check. Never a banner, never a shield JPEG.
- **Mono everything provable:** hashes, prev-hash links, audit timestamps, version IDs. Monospace =
  immutability made visible.
- **The Spine** (§5.4) turns the hash chain into a structure you can *see* — permanence as
  architecture.
- **Specific over generic:** "SHA-256 sealed · chain verified to genesis" not "🛡 Secure".
- **Restraint = credibility:** the amber-only law and the single glass moment read as *considered*,
  which reads as *trustworthy*. Mercury's lesson: premium through material + motion restraint, not
  chrome.

### The Seal (signature verification moment)
When a document's integrity validates:
1. A glass seal badge scales in with `--ease-seal` overshoot, `--dur-seal`.
2. A one-shot **amber specular sweep** crosses the badge (translateX a masked highlight,
   left→right, 500ms) — the Mercury "shimmer" analog.
3. Settles into the quiet mono caption `Sealed · v12 · a1b2…9f`.
Specular-edge CSS for the badge (nav/seal only, expensive):
```css
.seal::after{
  content:''; position:absolute; inset:0; border-radius:inherit; z-index:-1;
  box-shadow: inset -10px -8px 0 -11px rgba(255,255,255,1),
              inset  0px -9px 0 -8px  rgba(255,255,255,1);
  opacity:.6; filter: blur(1px) brightness(115%);
}
```
Instant, once, not decorative. This is where the whole "delight budget" is spent.

---

## 7. What we borrow, from whom (sources)

- **Single-accent restraint, LCH/OKLCH, elevation-by-opacity, inverted-L shell, sub-100ms, local
  ⌘K** — Linear.
  https://linear.app/now/how-we-redesigned-the-linear-ui ·
  https://performance.dev/how-is-linear-so-fast-a-technical-breakdown ·
  https://linear.app/now/linear-liquid-glass
- **Token-intent scales, monochrome foundation, negative tracking, spacing/radii** — Vercel Geist.
  https://vercel.com/geist/typography · https://designmd.cc/benchmarks/vercel
- **Optimistic UI + undo toast, ⌘K-teaches-shortcuts, mono timestamps, 3px accent border, 150ms
  micro-interactions** — Superhuman.
  https://blakecrosley.com/guides/design/superhuman
- **Springs, hover-peek sidebar, gradient space-badge + 4px bar, floating-surface shadow recipe** —
  Arc/Dia. https://blakecrosley.com/guides/design/arc
- **Switchable Views, pastel status pills, ALL-CAPS metadata, dense-but-beautiful tables** — Attio.
  https://www.saasui.design/application/attio
- **Liquid Glass (blur+saturate+bright edge, over-color-only, specular)** — Apple WWDC25 + recreations.
  https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/ ·
  https://dev.to/kevinbism/recreating-apples-liquid-glass-effect-with-pure-css-3gpl
- **WebGL mesh gradient floor** — Stripe. https://kevinhufnagl.com/how-to-stripe-website-gradient-effect/
- **Layered shadows / elevation tokens** — Josh Comeau. https://www.joshwcomeau.com/css/designing-shadows/
- **Motion rules (transform/opacity, <300ms, no ease-in, asymmetric, suppress on keyboard)** — Emil
  Kowalski + Rauno Freiberg. https://animations.dev/ · https://rauno.me/craft/interaction-design
- **Trust = specific claim + one icon, security cue at peak-anxiety; premium via material restraint**
  — Erik Fiala + Mercury. https://erikfiala.com/blog/psychology-trust-seals-badges-ui-design/ ·
  https://uxplanet.org/captivating-design-of-the-mercury-fintech-app-d472bc0288bb
- **Skeletons > spinners** — NN/g. https://www.nngroup.com/articles/skeleton-screens/
- **Hybrid version/audit timeline anatomy** — UX Patterns. https://uxpatterns.dev/patterns/data-display/timeline
- **Anti-AI-slop guardrails** — https://github.com/educlopez/ui-craft
- **Serif editorial voice / warm neutral archival mood** — Notion. https://mobbin.com/colors/brand/notion

---

## 8. Phased redesign plan (P0 → P3)

Each step ships behind the build→screenshot→critique loop: run the web app, capture the named
surfaces in **both themes**, diff against this vision, and only advance when the defect it targets
is visibly gone. Target files are the ones named in the critique.

### P0 — Make the ground real (kills the flatness). Highest impact.
Fixes defects #1, #2, #4, #5.
- Repoint `tokens.css`: retuned amber ramp (§2.2), resaturated status (§2.3), deeper dark canvas
  `#0B0B0F`, deeper light separation, `--elevation-{1..3}` + `--rim-light`, `--amber-glow-*`, new
  easings/durations (§4).
- Make content panes translucent so the Aura shows through: `Files.tsx` pane, `Shell.tsx`
  CenteredPane, `Sidebar.tsx` rail → `color-mix(... 82%, transparent)`.
- Ship the **static CSS Aura** (§2.4) in `AmbientGround.tsx` at real chroma/coverage.
- **Verify:** vault + shell in both themes — the amber-lit ground is now obviously visible behind
  the chrome; cards have lift; amber is present on the canvas. If the ground still reads flat, raise
  alpha before proceeding.

### P1 — Give documents identity + real depth.
Fixes defects #3, #5, #7.
- Vault cards: per-type gradient cover + thumbnail + colored glyph; resaturate `--ic-*`/`--tint-*`
  on the vault surface; 3px amber left rule + hairline top-bar for **Sealed**; hover **lift**.
- Amber owns primary actions: sign-in button, Settings Save, `+ New` → amber fill (defect #7).
- Apply `--elevation-*` + `--rim-light` to cards, popovers, dialogs.
- **Verify:** vault grid — no blank placeholder boxes; a PDF/Sheet/Doc are instantly distinguishable;
  sealed docs are visibly marked; hover lifts.

### P2 — Type + glass + shell rebalance.
Fixes defects #6, #8, #9.
- Add Newsreader display face; open the scale to 40/56/80; serif hero titles + big trust numerals;
  raise UI body 13→14.
- Real glass on command bar + editor pill + verification popover (§2.5); everything else flat.
- Remove the black `DemoBanner`; rebalance `TopBar` (breadcrumb+title left, command center, search
  right).
- **Verify:** shell + editor — top bar balanced, no black strip, hero titles have editorial weight,
  glass chrome refracts the Aura.

### P3 — The signature moments + motion.
Fixes defects #10, #11.
- **The Seal** (§6): amber specular sweep + spring badge on verification.
- **The Spine** (§5.4): living hash-chain timeline with travelling amber verify + settle-to-glow.
- **The Aura** WebGL upgrade on hero/auth/empty/vault-header.
- Motion pass: card/row lift, detail morph, Superhuman row-fill, ⌘K instant-open, hold-to-confirm
  on destructive ops; skeletons replace spinners.
- **Verify:** record a verification and a chain-verify; the Seal and Spine should read as the
  memorable emotional payoff. Empty/auth should have the one "wow" mesh surface.

**Loop discipline:** never advance a phase on code review alone — screenshot the real app in both
themes and critique against §0–§6. The failure mode we are correcting was a rich token system that
never reached the screen; the screenshot is the only proof it did.
