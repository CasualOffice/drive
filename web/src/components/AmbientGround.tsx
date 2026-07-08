/**
 * AmbientGround — a FLAT neobrutalist canvas (ui-system-neobrutal §7.1).
 *
 * The rejected soft-glass build painted a drifting amber "Aura" mesh here.
 * Neobrutalist has no aura, no gradient, no blur: this is a single fixed,
 * pointer-inert layer at `z-index: -1` that paints the flat paper/ink canvas
 * with a very subtle dotted-grid texture. All finish lives in the
 * `.ambient-ground` class in `styles/tokens.css` (dot color swaps per theme).
 *
 * Mounted once at the App root (App.tsx) above the auth gate, so every
 * screen — sign-in, setup, shell, editor, share, invite — sits on the same
 * flat ground with the bordered chrome/cards stacked over it.
 */
export function AmbientGround() {
  return <div className="ambient-ground" aria-hidden="true" />;
}
