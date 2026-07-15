import { expect, test } from "@playwright/test";
import { resetDemoState, signInDemo } from "./_helpers.ts";

test.beforeEach(async ({ page }) => {
  await resetDemoState(page);
});

test("a failed activity load shows a retry that recovers", async ({ page }) => {
  // Force the activity listing to fail. addInitScript runs after
  // resetDemoState's clear-init-script, so the flag survives the wipe and the
  // demo shim throws 503 for /api/activity (and the Files listing — harmless
  // here since we drive straight to the Activity tab).
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("cd-demo-force-error", "1");
    } catch {
      /* ignored */
    }
  });

  await signInDemo(page);

  // Open the Activity tab — its initial load fails.
  await page.getByRole("button").filter({ hasText: /^Activity$/ }).first().click();

  // The error surface takes over the body (no endless skeletons) and offers
  // recovery, rather than stranding the user on a spinner.
  await expect(page.getByText("Couldn't load activity.")).toBeVisible({
    timeout: 10_000,
  });
  const retry = page.getByRole("button", { name: "Try again" });
  await expect(retry).toBeVisible();
  // A fresh-load failure means no skeleton rows linger underneath.
  await expect(page.locator('[aria-label="Loading activity"]')).toHaveCount(0);

  // Clear the flag so the next fetch succeeds, then retry in place — no reload.
  await page.evaluate(() => {
    try {
      window.localStorage.removeItem("cd-demo-force-error");
    } catch {
      /* ignored */
    }
  });
  await retry.click();

  // Recovery: the error is gone and the seeded timeline renders.
  await expect(page.getByText("Couldn't load activity.")).toHaveCount(0);
  await expect(page.getByText("Append-only · hash-chained")).toBeVisible({
    timeout: 5_000,
  });
});
