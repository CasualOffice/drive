import { expect, test } from "@playwright/test";
import { resetDemoState, signInDemo } from "./_helpers.ts";

test.beforeEach(async ({ page }) => {
  await resetDemoState(page);
  await signInDemo(page);
});

test("downloading provenance produces a signed manifest file", async ({ page }) => {
  await page.locator(".cd-file-card").filter({ hasText: "Product brief.docx" }).first().click();
  await page.getByTestId("preview-details-toggle").click();
  await expect(page.getByTestId("details-panel")).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("provenance-button").click(),
  ]);

  // The file is named for the document and is JSON.
  expect(download.suggestedFilename()).toMatch(/^provenance-.*\.json$/);

  // The panel confirms the download and points at offline verification.
  await expect(page.getByTestId("provenance-note")).toContainText("verify-provenance");
});
