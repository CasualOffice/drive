import { expect, test } from "@playwright/test";
import { resetDemoState, signInDemo } from "./_helpers.ts";

test.beforeEach(async ({ page }) => {
  await resetDemoState(page);
});

test("a failed file-open load shows a retry that recovers", async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("cd-demo-force-error", "1");
    } catch {
      /* ignored */
    }
  });

  await signInDemo(page);

  // Client-side nav to the fullscreen editor route (a full reload would wipe the
  // demo session via resetDemoState's clear-init-script). App re-reads the path
  // on popstate.
  await page.evaluate(() => {
    window.history.pushState({}, "", "/file/f_quarter");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });

  // The cold getFile fails → error surface with a retry, not a dead end.
  const errorBox = page.getByTestId("file-fullscreen-error");
  await expect(errorBox).toBeVisible({ timeout: 10_000 });
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

  // Recovery: the error surface is gone and the document is named in the header.
  await expect(errorBox).toHaveCount(0);
  await expect(page.getByTestId("file-fullscreen-title")).toHaveText("Q2 planning.xlsx", {
    timeout: 5_000,
  });
});
