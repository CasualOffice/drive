import { expect, test } from "@playwright/test";
import { resetDemoState, signInDemo } from "./_helpers.ts";

test.beforeEach(async ({ page }) => {
  await resetDemoState(page);
});

test("a failed token-list load shows a retry that recovers", async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("cd-demo-force-error", "1");
    } catch {
      /* ignored */
    }
  });

  await signInDemo(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Tokens & sessions" }).click();
  await expect(page.getByRole("heading", { name: "Tokens & sessions" })).toBeVisible();

  // The token-list load failed → error band with a retry, not a dead end.
  await expect(page.getByText("demo: forced load error")).toBeVisible({ timeout: 10_000 });
  const retry = page.getByRole("button", { name: "Try again" });
  await expect(retry).toBeVisible();

  await page.evaluate(() => {
    try {
      window.localStorage.removeItem("cd-demo-force-error");
    } catch {
      /* ignored */
    }
  });
  await retry.click();

  // Recovery: the error is gone and the empty-state (no tokens yet) renders.
  await expect(page.getByText("demo: forced load error")).toHaveCount(0);
  await expect(page.getByText("No tokens yet.", { exact: false })).toBeVisible({ timeout: 5_000 });
});
