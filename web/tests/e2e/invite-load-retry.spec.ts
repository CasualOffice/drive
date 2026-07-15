import { expect, test } from "@playwright/test";
import { resetDemoState } from "./_helpers.ts";

test.beforeEach(async ({ page }) => {
  await resetDemoState(page);
});

// The invite-accept page (/invite/<token>) is public. A transient peek
// failure must offer a retry, not falsely claim the invite is expired/revoked.
test("a transient invite-peek failure offers a retry, not a dead end", async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("cd-demo-force-error", "1");
    } catch {
      /* ignored */
    }
  });

  await page.goto("/invite/demo-invite-token");

  // Transient failure → retryable surface, and NOT the misleading
  // "this invitation isn't available" (which would tell a valid invitee their
  // link is dead over a momentary outage).
  await expect(page.getByText("Something went wrong")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("This invitation isn't available")).toHaveCount(0);
  const retry = page.getByRole("button", { name: "Try again" });
  await expect(retry).toBeVisible();

  // Clear the fault and retry in place → the invite resolves.
  await page.evaluate(() => {
    try {
      window.localStorage.removeItem("cd-demo-force-error");
    } catch {
      /* ignored */
    }
  });
  await retry.click();

  await expect(page.getByText("Demo Workspace")).toBeVisible({ timeout: 5_000 });
});
