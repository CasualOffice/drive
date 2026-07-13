import { expect, test } from "@playwright/test";
import { resetDemoState, signInDemo } from "./_helpers.ts";

test.beforeEach(async ({ page }) => {
  await resetDemoState(page);
  await signInDemo(page);
});

test("summarizing a document shows an extractive summary", async ({ page }) => {
  await page.locator(".cd-file-card").filter({ hasText: "Product brief.docx" }).first().click();
  await page.getByTestId("preview-details-toggle").click();
  await expect(page.getByTestId("details-panel")).toBeVisible();

  await page.getByTestId("summarize-button").click();

  const results = page.getByTestId("summary-results");
  await expect(results).toBeVisible({ timeout: 5_000 });
  await expect(results).toContainText("Summary");
  // The summary is a verbatim excerpt of the brief's most salient content.
  await expect(results).toContainText(/Doc-Hub|document registry|search/);
  await expect(results).toContainText("nothing invented");
});
