/**
 * SR15 — Playwright baseline for keystroke→paint latency.
 * Spec: docs/ux/12-search-surface.md §"Performance budget".
 *
 * The SPA's lib/searchMetrics.ts opens a measurement window on every
 * first-keystroke-after-paint and closes it in a double-rAF after
 * the search effect setStates the result pane. Stats are surfaced
 * on `window.__cd_search_perf()`.
 *
 * This spec types a few real queries against the demo backend, reads
 * the rolling buffer, and asserts:
 *   - At least one measurement landed (the wiring is connected).
 *   - p95 is under a permissive 800 ms ceiling.
 *
 * The spec's actual target is 200 ms. We're keeping the threshold
 * permissive on first pass because CI variance on a shared GitHub
 * runner can spike well above the desktop-Chrome wall-clock — once
 * we have a few green runs to baseline against, the ceiling moves
 * toward 200 ms.
 */
import { expect, test } from "@playwright/test";
import { resetDemoState, signInDemo } from "./_helpers.ts";

type PerfStats = { count: number; p50_ms: number; p95_ms: number; max_ms: number } | null;

test.beforeEach(async ({ page }) => {
  await resetDemoState(page);
  await signInDemo(page);
});

test("search keystroke→paint latency stays under the permissive ceiling", async ({ page }) => {
  const search = page.getByPlaceholder("Search files and folders");

  // Exercise the search pipeline a few times against the seeded demo
  // corpus. Each iteration: clear, type, wait for visible result, blur.
  for (const q of ["plan", "Q2", "design"]) {
    await search.click();
    await search.fill("");
    await search.fill(q);
    // The search effect's debounce is 200 ms; allow generous slack so
    // the double-rAF + paint closes the measurement before we read.
    await page.waitForTimeout(450);
    await search.blur();
  }

  const stats: PerfStats = await page.evaluate(() => {
    const fn = (window as unknown as { __cd_search_perf?: () => PerfStats }).__cd_search_perf;
    return fn ? fn() : null;
  });

  // Diagnostic output — surfaced in CI logs so we accumulate a few
  // runs of baseline numbers before tightening the ceiling toward the
  // spec's 200 ms target.
  console.log("SR15 search perf stats:", JSON.stringify(stats));

  expect(stats, "instrumentation should have captured samples").not.toBeNull();
  if (!stats) return; // narrow for TS
  expect(stats.count, "at least one keystroke→paint pair landed").toBeGreaterThanOrEqual(1);
  // Permissive ceiling: well above the 200 ms target so flaky CI
  // variance doesn't fail the build. Tighten once we have data.
  expect(stats.p95_ms, "p95 within permissive ceiling").toBeLessThan(800);
});
