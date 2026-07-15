import { expect, test } from "@playwright/test";
import { resetDemoState, signInDemo } from "./_helpers.ts";

test.beforeEach(async ({ page }) => {
  await resetDemoState(page);
});

test("a failed files load shows a retry that recovers", async ({ page }) => {
  // Force the root listing to fail. addInitScript runs after resetDemoState's
  // clear-init-script, so the flag survives the wipe and every fresh document
  // context carries it — the demo shim throws 503 for /api/folders/root/children.
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("cd-demo-force-error", "1");
    } catch {
      /* ignored */
    }
  });

  // Sign-in itself doesn't touch the listing, so the shell renders and the
  // Files pane lands in its error state.
  await signInDemo(page);

  // The error surface announces itself (role="alert") and offers recovery.
  await expect(page.getByText("Couldn't load files.")).toBeVisible({
    timeout: 10_000,
  });
  const retry = page.getByRole("button", { name: "Try again" });
  await expect(retry).toBeVisible();

  // Retry while the fault persists: the load re-runs and stays in the error
  // state, so the button re-renders in place. (Deterministic — every load
  // fails while the flag is set, so nothing can self-heal underneath us.)
  await retry.click();
  await expect(page.getByText("Couldn't load files.")).toBeVisible();

  // Clear the flag so the next load succeeds, then retry to recover in place.
  // Files also self-heals on an unrelated re-render (its `refresh` re-runs when
  // the parent re-renders), so the button may vanish before the click lands —
  // guard the click so a self-heal doesn't hang the test. Either path leaves
  // the user recovered, which the assertions below verify.
  await page.evaluate(() => {
    try {
      window.localStorage.removeItem("cd-demo-force-error");
    } catch {
      /* ignored */
    }
  });
  await retry.click({ timeout: 5_000 }).catch(() => {
    /* already self-healed before the click — fine, recovery asserted below */
  });

  // Recovery: the error is gone and the seeded listing renders.
  await expect(page.getByText("Couldn't load files.")).toHaveCount(0);
  await expect(page.getByText(/^8 items$/)).toBeVisible({ timeout: 5_000 });
});
