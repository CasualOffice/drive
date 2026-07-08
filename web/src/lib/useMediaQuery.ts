/**
 * useMediaQuery — subscribe to a CSS media query from React. SSR-safe
 * (returns `false` on the server / first render before the effect runs,
 * so the desktop layout is the deterministic default — this keeps the
 * Playwright Desktop-Chrome e2e viewport on the unchanged desktop path).
 *
 * Responsive breakpoints (feat/ui-mobile):
 *   - mobile  ≤ 768px  → drawer sidebar, collapsed search, single-column panes
 *   - tablet  ≤ 1024px → intermediate reflow where it helps
 * Mirror the CSS breakpoints in src/styles/tokens.css (the `--vault-grid`
 * / `--files-grid` overrides live there); keep the two in sync.
 */
import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    // Sync immediately in case the query changed between render and effect.
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** Phone-width breakpoint — the drawer / collapse threshold. */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 768px)");
}

/** Tablet-and-below — used for intermediate reflows. */
export function useIsTablet(): boolean {
  return useMediaQuery("(max-width: 1024px)");
}
