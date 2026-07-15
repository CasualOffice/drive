import { expect, test } from "@playwright/test";
import { resetDemoState, signInDemo } from "./_helpers.ts";

test.beforeEach(async ({ page }) => {
  await resetDemoState(page);
});

test("a failed version-timeline load shows a retry that recovers", async ({ page }) => {
  // Only the versions load fails — the file-metadata load still succeeds, so
  // the page renders the <VersionHistory> component (not the page-level error)
  // and the component surfaces its OWN retry.
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("cd-demo-force-versions-error", "1");
    } catch {
      /* ignored */
    }
  });

  await signInDemo(page);

  await page.evaluate(() => {
    window.history.pushState({}, "", "/document/f_quarter/history");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });

  // The page header renders (getFile succeeded) but the timeline load failed →
  // the component's own error + retry, not a page-level dead end.
  const forcedErr = page.getByText("demo: forced versions error");
  await expect(forcedErr).toBeVisible({ timeout: 10_000 });
  const retry = page.getByRole("button", { name: "Try again" });
  await expect(retry).toBeVisible();

  await page.evaluate(() => {
    try {
      window.localStorage.removeItem("cd-demo-force-versions-error");
    } catch {
      /* ignored */
    }
  });
  await retry.click();

  // Recovery: the timeline loads, so the forced-error message and its retry
  // button are both gone.
  await expect(forcedErr).toHaveCount(0);
  await expect(retry).toHaveCount(0);
});
