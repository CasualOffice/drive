/**
 * AmbientGround — "the Aura" (ui-vision-2026 §2.4).
 *
 * The single biggest lever against the flat/dull look: a real, VISIBLE
 * atmospheric floor behind the whole app. An ink→slate→deep-amber radial
 * mesh at genuine chroma and coverage (alpha ~0.16–0.28, not the old
 * sub-perceptual 0.08 whisper), rendered as one fixed, GPU-cheap layer at
 * `z-index: -1` that never intercepts pointer events. The glass chrome
 * above blurs it for real vibrancy; translucent panes let it glow through.
 *
 * Mounted once at the App root (App.tsx) ABOVE the auth gate, so it shows
 * on EVERY screen — sign-in, setup, shell, editor, share, invite — and the
 * chrome/panels always stack over it.
 *
 * All finish lives in the `.ambient-ground` class in `styles/tokens.css`:
 * the mesh swaps per theme (light "Reading Room" default, dark "Registry"
 * flagship on #0B0B0F) and the slow ~24s drift is paused under
 * `prefers-reduced-motion: reduce`.
 */
export function AmbientGround() {
  return <div className="ambient-ground" aria-hidden="true" />;
}
