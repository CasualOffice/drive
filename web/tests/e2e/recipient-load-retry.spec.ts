import { expect, test } from "@playwright/test";
import { resetDemoState } from "./_helpers.ts";

test.beforeEach(async ({ page }) => {
  await resetDemoState(page);
});

// The share-recipient page (/s/<token>) is public — no sign-in. A transient
// resolve failure must offer a retry, not falsely claim the link is gone.
test("a transient share-resolve failure offers a retry, not a dead end", async ({ page }) => {
  // Force the resolve to fail with a 5xx. addInitScript runs after
  // resetDemoState's clear-init-script, so the flag survives the wipe.
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("cd-demo-force-error", "1");
    } catch {
      /* ignored */
    }
  });

  await page.goto("/s/demo-share-q2planning");

  // Transient failure → retryable error surface, and crucially NOT the
  // misleading "this link doesn't exist" (which would tell a recipient hitting
  // a momentary outage that their valid link is dead).
  await expect(page.getByText("Something went wrong.")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("This link doesn't exist.")).toHaveCount(0);
  const retry = page.getByRole("button", { name: "Try again" });
  await expect(retry).toBeVisible();

  // Clear the fault and retry in place → the seeded share resolves.
  await page.evaluate(() => {
    try {
      window.localStorage.removeItem("cd-demo-force-error");
    } catch {
      /* ignored */
    }
  });
  await retry.click();

  await expect(page.getByText("Q2 planning.xlsx")).toBeVisible({ timeout: 5_000 });
});
