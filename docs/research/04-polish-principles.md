# 04 — Polish Principles for Doc-Hub

**Audience:** the frontend engineer building Doc-Hub's web UI.
**Purpose:** translate the macOS-tier polish bar (Things 3, Linear, Raycast, Notion, Sonoma system apps, Tot, Bear, Craft, Fantastical, Arc, Sketch, Figma desktop) into rules and tokens Doc-Hub can adopt.
**Out of scope:** Doc-Hub's information architecture. This brief is about the *quality bar*, not the IA. It is **not** a Finder or Drive clone exercise.

---

## TL;DR

- Premium feel is the *absence* of noise, not the presence of effects. Strip chrome; let content carry the page.
- One primary action, one secondary, the rest is text or icon. Warmth re-enters through motion, copy, micro-interactions — not color.
- Type carries hierarchy: **weight + size + opacity** before boxes and dividers. Inter on web, SF Pro via `system-ui` on Apple. Tabular numerals are required for file sizes and dates.
- 4/8 px grid. Concentric corners: `inner + padding = outer`. Surfaces nest, not collide.
- Sub-100 ms for direct manipulation; 150–250 ms UI transitions; 400–600 ms full transitions. Springs for manipulation, eased curves for system motion. Respect `prefers-reduced-motion`.
- Optimistic UI for any plausibly-safe write. Skeleton screens beat spinners (~30% perceived speedup, [UI Deploy](https://ui-deploy.com/blog/skeleton-screens-vs-spinners-optimizing-perceived-performance)).
- Keyboard is a first-class surface. Cmd-K is the safety net, not the primary path. Every important action reachable from the keyboard and *advertised* next to it.
- Avoid cliché premium signals: heavy gradients, ubiquitous glassmorphism, text drop-shadows, neon focus rings.

---

## 1. Restraint and Hierarchy

Polished apps share one trait: most of the screen is empty by design. Linear, Things 3, Bear, Tot, Craft, Notes — all push a single content column on a near-blank canvas with chrome hidden until needed. Things 3's "Magic Plus" button is the canonical case: the *only* persistent affordance is a single circle the user drags where they want a new item ([MacStories review](https://www.macstories.net/reviews/things-3-beauty-and-delight-in-a-task-manager/)).

For Doc-Hub:

- **One primary, one secondary, the rest is text.** A toolbar with 12 buttons reads cheap; 2 buttons plus 10 keyboard shortcuts reads professional. Linear is explicit that the keyboard system is "not a feature — it is a core design philosophy" ([Linear design breakdown](https://www.925studios.co/blog/linear-design-breakdown-saas-ui-2026)).
- **Strip dividers; use space.** A 24 px gap separates two zones better than a 1 px line. Borders only earn their place inside a denser surface.
- **Warmth re-enters through motion, copy, and micro-interactions** — never color. The *behaviour* is the personality; the palette stays neutral.

## 2. Spacing Rhythm and Proportion

Apple's HIG layout page is JS-rendered and would not load via WebFetch; the numbers below come from community mirrors of the HIG and match what the polished reference apps actually ship ([apple-hig-designer skill](https://lobehub.com/skills/neversight-learn-skills.dev-apple-hig-designer), [HIG layout gist](https://gist.github.com/eonist/e79ca41b312362682343c41f63062734)). Treat as `[unverified]` against the canonical HIG.

- **Base unit: 4 px. Grid step: 8 px.** Padding inside controls uses 8/12/16; padding inside containers uses 12/16/20/24.
- **Target floor: 28 px desktop, 44 px touch.** Apple's documented minimum is 44 × 44 points for touch ([HIG summary](https://www.nadcab.com/blog/apple-human-interface-guidelines-explained)). Desktop tolerates 28 px for power-user tooling — Linear's row heights are around there — never less.
- **Concentric corner-radius rule:** `inner_radius + padding = outer_radius` ([rounded-corners deep dive](https://medium.com/minimal-notes/rounded-corners-in-the-apple-ecosystem-1b3f45e18fcc), [Arun on Apple corners](https://arun.is/blog/apple-rounded-corners/)). Breaking this rule is the single most reliable way to make a UI feel off without anyone being able to articulate why.
- **Optical alignment beats mathematical.** Triangular glyphs need a 1–2 px shove off center; labels next to monospace numbers align cap-height, not baseline. Squint test: if anything jumps, it's mis-aligned.
- **One density at v1.** Sonoma System Settings (§12) is the cautionary tale.

## 3. Typography

- **Family.** On Apple devices, `system-ui` resolves to SF Pro for free ([CSS-Tricks system stack](https://css-tricks.com/snippets/css/system-font-stack/), [Jim Nielsen on system fonts](https://blog.jim-nielsen.com/2020/system-fonts-on-the-web/)). For consistent cross-platform polish, load **Inter** ([rsms/inter](https://github.com/rsms/inter/blob/master/README.md)) and fall back to system fonts.
- **Inter ships tabular numerals by default**, plus contextual alternates, slashed zero, and geometry close to SF Pro ([Wikipedia](https://en.wikipedia.org/wiki/Inter_(typeface))). Tabular numerals are non-negotiable for Doc-Hub — file sizes, dates, counts must align in columns. Inter also has a `Display` cut for large headings ([issue #413](https://github.com/rsms/inter/issues/413)), mirroring Apple's SF Pro Text/Display split at ~19 pt ([HIG typography summary](https://www.nadcab.com/blog/apple-human-interface-guidelines-explained)).
- **Weight is the primary hierarchy tool, not size.** SF Pro ships nine weights ([Apple Fonts](https://developer.apple.com/fonts/)). Regular (400) body, medium (500) emphasized, semibold (600) headings, bold (700) sparingly. Never more than three weights on one screen.
- **Line-height:** 1.4–1.5 body, 1.2–1.3 headings, 1.0–1.1 tight UI labels.
- **Tracking:** -0.01 to -0.02 em on display sizes; 0 on body; slightly positive on UPPERCASE micro-labels (use sparingly).

## 4. Color

- **Restraint.** Two greys, one accent, the semantic four (success / warning / danger / info). That is the entire palette. Polished apps look monochrome from across the room.
- **True greys, not blue-tinted.** Tailwind's `slate` is blue-tinted; `neutral` and `zinc` are closer to the Apple feel.
- **Accent.** macOS lets the user pick the accent ([macSales](https://eshop.macsales.com/blog/50559-how-to-adjust-the-system-accent-highlight-colors-in-macos/)). Doc-Hub can't honor that exactly, but keep accent rare enough that it never fights the user's OS accent in surrounding chrome.
- **Semantic colors that adapt.** Apple's `NSColor.textColor` auto-resolves for dark/light ([Indie Stack](https://indiestack.com/2018/10/supporting-dark-mode-adapting-colors/)). Web equivalent: CSS variables under `data-theme` or `prefers-color-scheme`, with semantic names (`--fg-default`, `--bg-elevated`) — never raw hexes in components.
- **Dark mode is not "invert the light theme."** Plan it day one; retrofitting reveals semantic leaks. Dark mode needs its own (often warmer) greys and a slightly desaturated accent.
- **Vibrancy on the web.** `backdrop-filter: blur(20px) saturate(180%)` over a translucent fill is the closest the web gets to NSVisualEffectView ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/backdrop-filter), [web.dev](https://web.dev/articles/backdrop-filter)). Use sparingly — sidebar, popover, command palette — never as page background. Apple's guidance: vibrancy pulls color from behind the material to enhance depth ([Apple Materials](https://developer-mdn.apple.com/design/human-interface-guidelines/foundations/materials/)).

## 5. Motion and Easing

Apple's stance: animations should be quick, precise, ease-in-ease-out by default, optional via Reduce Motion ([HIG motion summary](https://medium.com/@foks.wang/ios-26-motion-design-guide-key-principles-and-practical-tips-for-transition-animations-74def2edbf7c)).

- **Durations.** 80–120 ms hover/press/focus; 150–250 ms UI transitions (panel slide, popover open); 400–600 ms full-screen transitions. Anything over 500 ms starts to feel unresponsive.
- **Curves.** Default `cubic-bezier(0.32, 0.72, 0, 1)` — the standard "Apple" ease-out used widely in the reference set. Ease-out on enter, ease-in on exit, ease-in-out only when the user can interrupt (a draggable drawer).
- **Spring physics for direct manipulation.** Anything dragged, dropped, pressed, or pulled deserves a spring. Motion (formerly Framer Motion) drives these with `stiffness`/`damping`/`mass` ([Motion docs](https://motion.dev/docs/react-transitions)). Doc-Hub defaults: `{ stiffness: 400, damping: 30 }` snappy, `{ stiffness: 200, damping: 25 }` soft.
- **`prefers-reduced-motion` is non-negotiable.** Wrap every transition >150 ms in a media query that flips it to a no-op or a 50 ms opacity fade ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion), [WCAG C39](https://www.w3.org/WAI/WCAG22/Techniques/css/C39)).

## 6. Focus and Interaction States

- **Focus ring.** 2 px at 60% accent opacity with 2 px offset. Subtle for mouse, sharp for keyboard. Never `outline: none` without a replacement. Use `:focus-visible` so mouse users don't see it.
- **Hover.** Background tint, not border. A 4–6% accent overlay (or 4–8% neutral grey) on the row. Cursor: `pointer` only for navigation; `default` for buttons (Apple convention).
- **Active / pressed.** 1 px translate-Y, slightly darker fill, 80 ms. The "press" feel comes from the 1 px move, not a shadow change.
- **Loading.** Inline spinner only inside the action that triggered it; never a full-screen blocker. **Skeleton screens for content, spinners only for short finite system tasks** ([UI Deploy](https://ui-deploy.com/blog/skeleton-screens-vs-spinners-optimizing-perceived-performance), [LogRocket](https://blog.logrocket.com/ux-design/skeleton-loading-screen-design/)).
- **No-flicker principle.** Reserve space for the spinner; render the skeleton at the *exact* footprint of loaded content. Never show a 50 ms spinner for a request that returned instantly.

## 7. Icon System

One family, one stroke weight, one grid. SF Symbols are Apple-only; on web pick:

- **Lucide** — Feather fork, 1,800+ icons on 24 × 24 grid at 2 px stroke, ISC license, 34M+ weekly downloads on `lucide-react` ([Lucide](https://lucide.dev/), [GitHub](https://github.com/lucide-icons/lucide)). The safe default for a Linear/Vercel/shadcn-feeling product.
- **Phosphor** — 1,300+ icons in **six weights** (thin/light/regular/bold/fill/duotone) ([Phosphor](https://phosphoricons.com/)). Use when you need stylistic range — filled icons for selected sidebar items, outline for unselected.
- **Heroicons** — ~300 icons, outline + solid + 20/16 px variants ([icon library overview](https://hugeicons.com/blog/development/best-open-source-icon-libraries)). Smallest, hand-tuned for Tailwind.
- **Iconoir** — 1,600+ stroke icons, customizable stroke width, MIT.

**Recommendation: Lucide primary, Phosphor fallback for missing glyphs.** Never mix two families on the same screen. Same glyph for the same concept everywhere — if "folder" is `lucide:folder`, that's the folder icon in the sidebar, breadcrumb, action button, and empty state.

## 8. Surface and Depth

Apple layers blurred + tinted surfaces for z-axis depth ([Apple Materials](https://developer-mdn.apple.com/design/human-interface-guidelines/foundations/materials/)). The web's kit is smaller, so be disciplined:

- **Hairline borders** (`1px solid rgba(0,0,0,0.08)` light / `rgba(255,255,255,0.08)` dark) for in-plane separation.
- **Soft drop shadows** for elevation: `sm: 0 1px 2px /0.04` flat, `md: 0 4px 12px /0.06` popovers, `lg: 0 8px 24px /0.08` modals, `xl: 0 24px 60px /0.16` drawers. Always pair with a 1 px hairline on light backgrounds — shadow alone reads soft on whites.
- **Inner shadows on focused inputs.** 1 px inner shadow + focus ring is the Sketch / Things 3 trick that makes inputs feel pressed-in rather than flat.
- **Vibrancy via `backdrop-filter`.** Sidebar, command palette, popovers can opt into `backdrop-filter: saturate(180%) blur(20px)` over a 70–80% opaque fill ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/backdrop-filter)). Never stack two blurred surfaces ([NN/g on glassmorphism](https://www.nngroup.com/articles/glassmorphism/)).

## 9. Empty States

Apple pattern: single symbol, one-line title in body color, optional secondary line in muted color, at most one button. Bear, Notes, Reminders all follow this.

- **First launch:** hero symbol, "Drop files here, or use the upload button.", one primary `Upload` button. No tutorial overlay.
- **Empty folder:** smaller symbol, "This folder is empty.", no button.
- **Empty search:** "No files matched <query>.", a "Clear search" link. Never blame the user; never "Oops".
- Apple voice principles — *clarity, simplicity, friendliness, helpfulness* ([Ask WWDC](https://askwwdc.com/q/1093), [Apple tone analysis](https://www.copystyleguide.com/apple-tone-of-voice)) — apply here more than anywhere.

## 10. Sound and Haptics

Web has no haptics and only `<audio>` for sound. **Don't add sound or fake haptics in a document hub** — users wouldn't expect it. Reserve for a future native wrapper if one ships.

## 11. Perceived Speed and Loading

The most important section. Doc-Hub's user compares it to Linear, where a created issue lands in the UI in under 100 ms ([performance.dev](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown)).

- **The 100 ms rule.** Below ~100 ms, users perceive cause and effect as simultaneous ([response time limits](https://uxuiprinciples.com/en/principles/response-time-limits)). Below 400 ms (Doherty threshold), users stay in flow ([Laws of UX](https://lawsofux.com/doherty-threshold/)). Doc-Hub's target: every direct manipulation <100 ms, every navigation <400 ms.
- **Optimistic UI.** Rename, move, star, delete — UI updates immediately; server call happens in background; reconciliation rolls back on failure. Linear's pattern: write to local store (MobX + IndexedDB queue), reflect in UI, queue for server, reconcile ([performance.dev](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown), [Vinta](https://www.vintasoftware.com/lessons-learned/hows-linear-so-fast-a-technical-breakdown)). Doc-Hub should adopt the same shape.
- **Skeleton screens.** Identical waits feel ~20–30% faster with skeletons ([UI Deploy](https://ui-deploy.com/blog/skeleton-screens-vs-spinners-optimizing-perceived-performance)).
- **Pre-fetch on hover.** Hover a folder for >100 ms → start fetching its contents. By click, data has often arrived.
- **Cache aggressively, invalidate carefully.** Anything Doc-Hub has shown the user should be available offline. Boot from cache, then revalidate.

## 12. Density vs Breathing Room

Sonoma System Settings is the most-cited recent Apple app to break its own polish bar — cramped layout, HIG violations ([Lapcat](https://lapcatsoftware.com/articles/SystemSettings.html), [AppleInsider on the macOS 15 redo](https://appleinsider.com/articles/24/05/23/system-settings-getting-shuffled-again-in-macos-15-among-other-ui-tweaks)). A dense layout with no rhythm reads as cluttered even when every item is well-designed.

- **Linear / Raycast / Fantastical:** dense; works because every row has consistent height and clear column rhythm. Fantastical is praised as "information-dense without feeling cluttered" ([The Sweet Setup](https://thesweetsetup.com/fantastical-review-calendar-app/)).
- **Notion / Craft / Bear:** spacious; works because the content *is* the product.
- **Doc-Hub sits in the middle.** List view dense (~32–36 px rows, 13 px type, columns aligned, Linear-ish). Detail/preview pane spacious (Bear-ish padding, content-led).

## 13. Information Architecture Polish

Doc-Hub's IA is its own, but these IA-*polish* patterns are universal:

- **Breadcrumbs that fade.** 13 px muted grey, clickable segments, current in default-fg weight. Truncate the middle with `…`; never wrap. Hover shows full path.
- **Inline editing, not modal (Things 3 pattern).** Tap an item, it expands in place; the editor appears inline; the rest dims slightly. Doc-Hub should do this for rename, properties, quick edits.
- **Cmd-K command palette.** Universal escape hatch. Every action — including ones with a visible button — reachable here. Use [`cmdk`](https://cmdk.paco.me/) — the de facto React library (Linear, Vercel, Raycast use it).
- **Sidebar that earns its width.** Arc's reinvention: sidebar is where state and identity live, not a nav graveyard ([Blake Crosley on Arc](https://blakecrosley.com/guides/design/arc), [LogRocket UX](https://blog.logrocket.com/ux-design/ux-analysis-arc-opera-edge/)). Doc-Hub: collapsible, persistent per user. ~240 px expanded, ~52 px collapsed.

## 14. Keyboard-First

Linear: "every interaction feels instant because of optimistic UI, skeleton states, and aggressive caching... the keyboard shortcut system is not a feature — it is a core design philosophy" ([Linear design breakdown](https://www.925studios.co/blog/linear-design-breakdown-saas-ui-2026)).

- **Every important action has a shortcut.** Upload (U), New folder (N), Rename (R / F2), Delete (Backspace), Search (/), Cmd-K, arrows to navigate, Space to select, Enter to open.
- **Show the chord where the action lives** — tooltip, menu item, button. Muted text on the right. No cheatsheet required.
- **Cmd-K is the safety net, not the primary path.** If the user has to open the palette to do something common, the IA has failed.
- **Predictable focus.** Tab order mirrors visual reading order. Esc always closes the nearest dismissible surface.

## 15. Copy and Microcopy

Two reference voices:

- **Apple:** warm, direct, present-tense, conversational. "Drop files here." Four qualities: *clarity, simplicity, friendliness, helpfulness* ([copystyleguide](https://www.copystyleguide.com/apple-tone-of-voice), [Ask WWDC](https://askwwdc.com/q/1093)).
- **Linear:** terse, present-tense, declarative, occasionally dry. "Created." "Couldn't reach the server."

**Lean Apple in onboarding and empty states, Linear in confirmations and errors.** Rules:

- Verbs in titles, not nouns. "Move to trash", not "Trash".
- No "Oops", "Whoops", "Oh no". Be honest: "Couldn't save. Try again?"
- No exclamation marks except in genuine celebration.
- Sentence case throughout; Title Case only for proper names.
- Errors name *what went wrong* and *what to do next*, in that order.

## 16. Small Details People Copy from Apple

Touches no one user notices individually, but collectively make the product feel expensive.

- **Concentric corner-radius hierarchy:** `4` chips, `6` buttons/inputs, `8` small cards, `12` panels/popovers, `16` modals/drawers, `20+` sheets ([rounded corners in Apple](https://medium.com/minimal-notes/rounded-corners-in-the-apple-ecosystem-1b3f45e18fcc), [Arun on Apple corners](https://arun.is/blog/apple-rounded-corners/)).
- **Inner shadow on focused inputs.** 1 px inset + focus ring → pressed-in feel.
- **Soft drop shadows in the `0 8px 24px /0.08` family.** Never `0 2px 4px /0.5` — reads as a 2013 Bootstrap card.
- **Hairline borders.** `1px solid rgba(0,0,0,0.08)` — "edge present but not seen".
- **Cursor discipline.** `pointer` only for navigation; `default` for buttons; `text` for editable; `grab`/`grabbing` for drag handles.
- **Selection color = accent at low opacity.** Don't ship OS-default blue on a custom UI.
- **Tabular numerals in lists.** `font-variant-numeric: tabular-nums` on any number column.
- **`overflow-wrap: anywhere`** on filenames; long names never widen columns.

## 17. Web-Specific Challenges

- **No SF Pro outside Apple** → load Inter; let Apple devices keep SF via the system stack ([rsms/inter](https://github.com/rsms/inter/blob/master/README.md)).
- **No NSVisualEffectView vibrancy** → `backdrop-filter: saturate(180%) blur(20px)` with translucent fill ([web.dev](https://web.dev/articles/backdrop-filter)). Close, not identical; Safari renders best.
- **No haptics, no system sounds** → don't fake them.
- **Custom focus rings = accessibility tax** → use `:focus-visible`, test with a screen reader.
- **Scrollbars are platform-dependent** → style lightly (`::-webkit-scrollbar` + `scrollbar-width: thin`); never hide entirely.
- **No real menu bar** → kebab menu + command palette together.

## 18. Reference Apps — What to Study

- **Things 3 (Cultured Code)** — restraint, type, Magic Plus. How a single persistent affordance carries the whole input model ([MacStories](https://www.macstories.net/reviews/things-3-beauty-and-delight-in-a-task-manager/), [features page](https://culturedcode.com/things/features/)).
- **Linear** — keyboard, density, Cmd-K, optimistic UI, sync engine. Read the performance.dev breakdown twice ([performance.dev](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown), [redesign post](https://linear.app/now/how-we-redesigned-the-linear-ui)).
- **Raycast** — instant search, list interaction, "do nothing until typed" minimalism, keyword command-discovery ([Pixelmatters](https://www.pixelmatters.com/insights/raycast-for-software-engineers), [Hack Design](https://www.hackdesign.org/toolkit/raycast/)).
- **Notion (native macOS)** — block hierarchy, slash menu, drag handles. `/` as both creation shortcut and discovery surface ([keyboard shortcuts](https://www.notion.com/help/keyboard-shortcuts)).
- **Sonoma Notes / Reminders** — canonical native list-detail: sidebar of collections, middle list, right pane for the active item.
- **Arc** — sidebar reinvention, spaces, persistent workspace state. Study the philosophy even though the product is sunsetting ([Blake Crosley](https://blakecrosley.com/guides/design/arc), [Refine](https://refine.dev/blog/arc-browser/)).
- **Fantastical** — density done right; multiple coordinated views over the same data ([Sweet Setup](https://thesweetsetup.com/fantastical-review-calendar-app/)).
- **Sketch / Figma desktop** — file-list and asset-browser polish, most directly relevant to Doc-Hub. Study Figma's file browser (teams → projects → files) and the Assets panel ([file browser guide](https://help.figma.com/hc/en-us/articles/14381406380183-Guide-to-the-file-browser), [libraries guide](https://help.figma.com/hc/en-us/articles/360041051154-Guide-to-libraries-in-Figma)).

---

## The 10 Commandments

Single-page distillation. Doc-Hub's UI must never break these.

1. **One primary action per screen.** One secondary. The rest is text or icon.
2. **Type carries hierarchy.** Use weight + size + opacity before reaching for boxes, dividers, or color.
3. **Snap to the 4 / 8 grid.** Always. No magic numbers.
4. **Corners are concentric.** `inner + padding = outer`. No exceptions.
5. **Sub-100 ms or it's broken.** Optimistic UI for every plausibly-safe write.
6. **Skeletons, not spinners,** for content. Spinners only for short, finite system tasks.
7. **The keyboard is a first-class surface.** Every important action has a shortcut, and the shortcut is *advertised* where the action lives.
8. **`prefers-reduced-motion` is honored everywhere.** No exceptions.
9. **One icon family, one stroke weight.** Same glyph for the same concept across the entire app.
10. **Copy is warm, direct, present-tense, sentence-case.** Errors say *what* and *what next*, never "Oops".

---

## Anti-Patterns to Avoid

Clichés that read as "trying to look premium" and therefore read as cheap.

- **Omnipresent glassmorphism.** A blurred sidebar is fine. Three stacked blurred surfaces is muddy and slow — NN/g flags both readability and performance ([NN/g](https://www.nngroup.com/articles/glassmorphism/)). Reserve blur for one surface per screen.
- **Gradient primary buttons.** Flat accent + hairline border + soft shadow always reads more premium than purple-to-pink.
- **Heavy drop shadows.** `0 8px 24px /0.5` is a 2013 card. Stay in the 0.04–0.16 alpha range.
- **Drop-shadow on text.** Reads as Web 2.0 except on white-over-photo for contrast.
- **Neon focus rings.** 3 px at full opacity is loud; 2 px at 60% is the sweet spot.
- **Animating everything.** Polish is selective motion. Hover + focus + click + route + tooltip all animating = hyperactive.
- **"Oops!" / "Whoops!"** Cute, condescending, a sign no one owned the voice.
- **Multiple primary buttons.** `Cancel`, `Save Draft`, `Publish` all in the same fill = UX failure.
- **Custom scrollbars that hide.** Slick in screenshots, accessibility failure.
- **Dark mode as inverted light.** Pure black on pure white feels cheap; use warm-dark greys.
- **Modals that open modals.** IA is wrong.

---

## Web Frameworks / Libraries That Help

- **Radix UI Primitives** — 30+ unstyled, accessible primitives (Dialog, Dropdown, Tabs, Popover), WAI-ARIA compliant, focus/keyboard handled ([docs](https://www.radix-ui.com/primitives/docs/overview/introduction), [GitHub](https://github.com/radix-ui/primitives)). The foundation layer.
- **shadcn/ui** — copy-paste components on Radix + Tailwind; you own the code ([site](https://ui.shadcn.com/), [Vercel Academy](https://vercel.com/academy/shadcn-ui)). The visual layer.
- **Framer Motion / Motion** — React animation, spring + tween, gestures ([docs](https://motion.dev/docs/react)). The motion layer.
- **vaul** — drawer for React, built on Radix Dialog, drag-to-dismiss ([GitHub](https://github.com/emilkowalski/vaul), [site](https://vaul.emilkowal.ski/)).
- **cmdk** — composable command palette, de facto React Cmd-K (Linear/Vercel/Raycast/Sourcegraph) ([site](https://cmdk.paco.me/), [npm](https://www.npmjs.com/package/cmdk/v/0.1.0)).
- **sonner** — opinionated toast, 40M+ weekly downloads, default in shadcn/ui ([GitHub](https://github.com/emilkowalski/sonner), [site](https://sonner.emilkowal.ski/)).
- **lucide-react** — icon family, 34M+ weekly downloads, 1,800+ icons, 24 × 24, 2 px stroke, ISC ([GitHub](https://github.com/lucide-icons/lucide)).

Bundle this set and you have everything except the document-hub logic.

---

## Starter Token Set

Copy verbatim into Doc-Hub's design tokens. Tune later; ship this first.

```css
/* ===== Typography ===== */
--font-sans: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
--font-display: 'Inter Display', 'Inter', system-ui, sans-serif;
--font-mono: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace;

/* Type scale (mobile = same; let it scale via vw on display sizes later) */
--text-xs:   11px;  /* metadata, chips */
--text-sm:   13px;  /* dense list rows, table cells */
--text-base: 14px;  /* body, inputs */
--text-md:   15px;  /* default body in spacious surfaces */
--text-lg:   17px;  /* section subtitles */
--text-xl:   20px;  /* page subtitles */
--text-2xl:  24px;  /* page titles */
--text-3xl:  30px;  /* hero, empty-state titles */
--text-4xl:  38px;  /* marketing only */

/* Line-height */
--leading-tight:  1.2;
--leading-snug:   1.35;
--leading-normal: 1.5;

/* Weight */
--weight-regular:   400;
--weight-medium:    500;
--weight-semibold:  600;
--weight-bold:      700;

/* Tracking */
--tracking-tight:  -0.01em;
--tracking-normal: 0;
--tracking-wide:    0.02em;

/* ===== Spacing (4 / 8 grid) ===== */
--space-0:   0;
--space-1:   4px;
--space-2:   8px;
--space-3:  12px;
--space-4:  16px;
--space-5:  20px;
--space-6:  24px;
--space-8:  32px;
--space-10: 40px;
--space-12: 48px;
--space-16: 64px;

/* ===== Radius (concentric) ===== */
--radius-xs:   4px;  /* chips, tags */
--radius-sm:   6px;  /* buttons, inputs */
--radius-md:   8px;  /* small cards, rows */
--radius-lg:  12px;  /* panels, popovers */
--radius-xl:  16px;  /* modals, drawers */
--radius-2xl: 20px;  /* large sheets */
--radius-full: 9999px;

/* ===== Color (light) ===== */
--bg-canvas:    #FAFAFA;
--bg-default:   #FFFFFF;
--bg-elevated:  #FFFFFF;
--bg-subtle:    #F4F4F5;
--bg-hover:     rgba(0, 0, 0, 0.04);
--bg-selected:  rgba(10, 132, 255, 0.10);

--fg-default:   #18181B;
--fg-muted:     #52525B;
--fg-subtle:    #A1A1AA;
--fg-onAccent:  #FFFFFF;

--border-default: rgba(0, 0, 0, 0.08);
--border-strong:  rgba(0, 0, 0, 0.14);

--accent:       #0A84FF;  /* macOS-flavored blue, neutral default */
--accent-hover: #0070E0;
--accent-muted: rgba(10, 132, 255, 0.12);

--success: #34C759;
--warning: #FF9F0A;
--danger:  #FF3B30;
--info:    #5AC8FA;

/* ===== Color (dark) — apply under [data-theme="dark"] ===== */
--bg-canvas-dark:   #0A0A0B;
--bg-default-dark:  #131316;
--bg-elevated-dark: #1A1A1F;
--bg-subtle-dark:   #1F1F25;
--bg-hover-dark:    rgba(255, 255, 255, 0.06);
--bg-selected-dark: rgba(10, 132, 255, 0.18);

--fg-default-dark:  #F4F4F5;
--fg-muted-dark:    #A1A1AA;
--fg-subtle-dark:   #71717A;

--border-default-dark: rgba(255, 255, 255, 0.08);
--border-strong-dark:  rgba(255, 255, 255, 0.14);

/* ===== Shadows ===== */
--shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.04);
--shadow-sm: 0 2px 6px rgba(0, 0, 0, 0.05);
--shadow-md: 0 4px 12px rgba(0, 0, 0, 0.06);
--shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.08);
--shadow-xl: 0 24px 60px rgba(0, 0, 0, 0.16);
--shadow-inner-input: inset 0 1px 1px rgba(0, 0, 0, 0.04);

/* ===== Motion ===== */
--ease-out:   cubic-bezier(0.32, 0.72, 0,    1);
--ease-in:    cubic-bezier(0.45, 0,    0.55, 1);
--ease-inout: cubic-bezier(0.65, 0,    0.35, 1);

--dur-fast:   120ms;
--dur-base:   200ms;
--dur-slow:   400ms;
--dur-slower: 600ms;

/* Spring presets (apply via Motion / Framer Motion) */
/* snappy:  { stiffness: 400, damping: 30 } */
/* soft:    { stiffness: 200, damping: 25 } */
/* gentle:  { stiffness: 120, damping: 22 } */

/* ===== Focus ===== */
--focus-ring: 0 0 0 2px var(--bg-default), 0 0 0 4px rgba(10, 132, 255, 0.6);

/* ===== z-index scale ===== */
--z-dropdown:  1000;
--z-sticky:    1100;
--z-overlay:   1200;
--z-modal:     1300;
--z-popover:   1400;
--z-toast:     1500;
--z-tooltip:   1600;
```

Tailwind users: drop these into `theme.extend` in `tailwind.config.js`. shadcn/ui consumers: map `--bg-default` → `--background`, `--fg-default` → `--foreground`, `--accent` → `--primary`, etc., in `globals.css`.

---

## Sources

URLs accessed during research (via WebSearch result snippets — WebFetch was permission-denied on most hosts; specific Apple HIG pages did not render and the spec numbers in §2 are flagged `[unverified]` against the canonical HIG).

Apple HIG and ecosystem:

- [HIG root](https://developer.apple.com/design/human-interface-guidelines/) · [Layout](https://developer.apple.com/design/human-interface-guidelines/layout) · [Typography](https://developer.apple.com/design/human-interface-guidelines/typography) · [Motion](https://developer.apple.com/design/human-interface-guidelines/motion) · [Materials](https://developer-mdn.apple.com/design/human-interface-guidelines/foundations/materials/) · [Writing](https://developer.apple.com/design/human-interface-guidelines/writing) · [Fonts](https://developer.apple.com/fonts/)
- [HIG summary (Nadcab)](https://www.nadcab.com/blog/apple-human-interface-guidelines-explained) · [HIG spacing gist](https://gist.github.com/eonist/e79ca41b312362682343c41f63062734) · [apple-hig-designer token mirror](https://lobehub.com/skills/neversight-learn-skills.dev-apple-hig-designer) · [iOS 26 motion guide](https://medium.com/@foks.wang/ios-26-motion-design-guide-key-principles-and-practical-tips-for-transition-animations-74def2edbf7c)
- [Apple Style Guide PDF](https://help.apple.com/pdf/applestyleguide/en_US/apple-style-guide.pdf) · [Apple voice analysis](https://www.copystyleguide.com/apple-tone-of-voice) · [Ask WWDC: Apple voice](https://askwwdc.com/q/1093)
- [Rounded corners in Apple](https://medium.com/minimal-notes/rounded-corners-in-the-apple-ecosystem-1b3f45e18fcc) · [Arun on Apple corners](https://arun.is/blog/apple-rounded-corners/)
- [macSales: macOS accent colors](https://eshop.macsales.com/blog/50559-how-to-adjust-the-system-accent-highlight-colors-in-macos/) · [Indie Stack: dark mode](https://indiestack.com/2018/10/supporting-dark-mode-adapting-colors/)
- [Lapcat: Ventura System Settings](https://lapcatsoftware.com/articles/SystemSettings.html) · [AppleInsider: macOS 15 settings redo](https://appleinsider.com/articles/24/05/23/system-settings-getting-shuffled-again-in-macos-15-among-other-ui-tweaks)

Typography and icons:

- [Inter README](https://github.com/rsms/inter/blob/master/README.md) · [Inter Wikipedia](https://en.wikipedia.org/wiki/Inter_(typeface)) · [Inter issue #413](https://github.com/rsms/inter/issues/413)
- [CSS-Tricks system font stack](https://css-tricks.com/snippets/css/system-font-stack/) · [Jim Nielsen on system fonts](https://blog.jim-nielsen.com/2020/system-fonts-on-the-web/) · [Modern Font Stacks](https://github.com/system-fonts/modern-font-stacks)
- [Lucide](https://lucide.dev/) · [Lucide GitHub](https://github.com/lucide-icons/lucide) · [Phosphor](https://phosphoricons.com/) · [Icon library overview](https://hugeicons.com/blog/development/best-open-source-icon-libraries)

Materials, motion, performance, voice:

- [MDN backdrop-filter](https://developer.mozilla.org/en-US/docs/Web/CSS/backdrop-filter) · [web.dev backdrop-filter](https://web.dev/articles/backdrop-filter) · [NN/g glassmorphism](https://www.nngroup.com/articles/glassmorphism/)
- [MDN prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion) · [WCAG C39](https://www.w3.org/WAI/WCAG22/Techniques/css/C39)
- [UI Deploy: skeletons vs spinners](https://ui-deploy.com/blog/skeleton-screens-vs-spinners-optimizing-perceived-performance) · [LogRocket: skeleton design](https://blog.logrocket.com/ux-design/skeleton-loading-screen-design/)
- [Laws of UX: Doherty](https://lawsofux.com/doherty-threshold/) · [Response time limits](https://uxuiprinciples.com/en/principles/response-time-limits) · [LogRocket Doherty](https://blog.logrocket.com/ux-design/designing-instant-feedback-doherty-threshold/)

Reference apps:

- [Linear redesign](https://linear.app/now/how-we-redesigned-the-linear-ui) · [performance.dev: Linear](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown) · [Vinta: Linear lessons](https://www.vintasoftware.com/lessons-learned/hows-linear-so-fast-a-technical-breakdown) · [925studios: Linear](https://www.925studios.co/blog/linear-design-breakdown-saas-ui-2026)
- [Pixelmatters: Raycast](https://www.pixelmatters.com/insights/raycast-for-software-engineers) · [Hack Design: Raycast](https://www.hackdesign.org/toolkit/raycast/) · [Destiner: command palette design](https://destiner.io/blog/post/designing-a-command-palette/)
- [Things 3 features](https://culturedcode.com/things/features/) · [MacStories: Things 3](https://www.macstories.net/reviews/things-3-beauty-and-delight-in-a-task-manager/)
- [Blake Crosley: Arc](https://blakecrosley.com/guides/design/arc) · [Refine: Arc](https://refine.dev/blog/arc-browser/) · [LogRocket: Arc UX](https://blog.logrocket.com/ux-design/ux-analysis-arc-opera-edge/)
- [Fantastical](https://flexibits.com/fantastical) · [Sweet Setup: Fantastical](https://thesweetsetup.com/fantastical-review-calendar-app/) · [Notion shortcuts](https://www.notion.com/help/keyboard-shortcuts)
- [Figma file browser](https://help.figma.com/hc/en-us/articles/14381406380183-Guide-to-the-file-browser) · [Figma libraries](https://help.figma.com/hc/en-us/articles/360041051154-Guide-to-libraries-in-Figma)

Libraries:

- [Radix Primitives docs](https://www.radix-ui.com/primitives/docs/overview/introduction) · [Radix GitHub](https://github.com/radix-ui/primitives) · [shadcn/ui](https://ui.shadcn.com/) · [Vercel Academy: shadcn](https://vercel.com/academy/shadcn-ui)
- [Motion docs](https://motion.dev/docs/react) · [Motion transitions](https://motion.dev/docs/react-transitions)
- [vaul GitHub](https://github.com/emilkowalski/vaul) · [vaul site](https://vaul.emilkowal.ski/) · [cmdk](https://cmdk.paco.me/) · [cmdk npm](https://www.npmjs.com/package/cmdk/v/0.1.0) · [sonner GitHub](https://github.com/emilkowalski/sonner) · [sonner site](https://sonner.emilkowal.ski/)
