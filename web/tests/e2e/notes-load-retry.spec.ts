import { expect, test } from "@playwright/test";
import { resetDemoState, signInDemo } from "./_helpers.ts";

test.beforeEach(async ({ page }) => {
  await resetDemoState(page);
});

test("a failed notes-tree load shows a retry that recovers", async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("cd-demo-force-error", "1");
    } catch {
      /* ignored */
    }
  });

  await signInDemo(page);
  await page.getByRole("button", { name: "Notes" }).click();

  // The tree load failed → persistent error + retry, NOT the misleading
  // "No notes yet" empty state. (Both the tree pane and the content pane show
  // an error + retry, so scope to the first.)
  await expect(page.getByText(/Couldn't load notes/).first()).toBeVisible({ timeout: 10_000 });
  const retry = page.getByRole("button", { name: "Try again" }).first();
  await expect(retry).toBeVisible();

  await page.evaluate(() => {
    try {
      window.localStorage.removeItem("cd-demo-force-error");
    } catch {
      /* ignored */
    }
  });
  await retry.click();

  // Recovery: the error is gone. (A fresh demo notebook is empty, so the
  // empty-state now renders legitimately — no longer masking a failure.)
  await expect(page.getByText(/Couldn't load notes/)).toHaveCount(0);
  await expect(page.getByText("No notes yet.")).toBeVisible({ timeout: 5_000 });
});
