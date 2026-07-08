/**
 * appearance — Drive's *resolved* light/dark, shared by both editor mounts.
 *
 * Drive's `ThemeToggle` cycles light → dark → system:
 *   - light / dark → writes `data-theme` on `<html>`.
 *   - system       → REMOVES `data-theme` so the `@media (prefers-color-scheme)`
 *                    block in tokens.css drives the palette from the OS.
 *
 * The editor SDKs can't read Drive's palette from CSS alone:
 *   - `<CasualSheets appearance>` is a JS prop (Univer theme) — it needs the
 *     *resolved* word, not the attribute.
 *   - `<CasualEditor>` (docs) triggers dark purely on `[data-theme="dark"]`
 *     matching an ancestor — it does NOT honour `prefers-color-scheme`. So in
 *     "system" mode (attribute removed) with an OS-dark preference, Drive's
 *     chrome goes dark but the docs editor would stay light. The mounts fix
 *     this by mirroring the resolved word onto the editor subtree.
 *
 * `resolveAppearance()` collapses both signals (attribute OR OS preference)
 * into a single "light" | "dark", and `subscribeAppearance()` fires on either
 * changing (the toggle flipping the attribute, or the OS preference flipping
 * while in system mode).
 */

export type Appearance = "light" | "dark";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Drive's effective appearance right now: the explicit `data-theme` override
 *  when set, else the OS preference (the "system" path). */
export function resolveAppearance(): Appearance {
  if (typeof document === "undefined") return "light";
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark") return "dark";
  if (attr === "light") return "light";
  // "system" (or unset) → follow the OS, matching tokens.css's @media block.
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
  }
  return "light";
}

/** Subscribe to appearance changes from BOTH sources — the toggle mutating
 *  `data-theme`, and (in system mode) the OS preference flipping. Returns an
 *  unsubscribe. The callback receives the freshly-resolved appearance. */
export function subscribeAppearance(onChange: (next: Appearance) => void): () => void {
  if (typeof document === "undefined") return () => {};
  const emit = () => onChange(resolveAppearance());

  const observer = new MutationObserver(emit);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  const media = window.matchMedia?.(DARK_QUERY);
  media?.addEventListener("change", emit);

  return () => {
    observer.disconnect();
    media?.removeEventListener("change", emit);
  };
}
