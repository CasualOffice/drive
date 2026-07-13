import { expect, test } from "@playwright/test";
import { resetDemoState, signInDemo } from "./_helpers.ts";

test.beforeEach(async ({ page }) => {
  await resetDemoState(page);
  await signInDemo(page);
});

test("scanning a document surfaces masked PII findings", async ({ page }) => {
  // Open the seeded brief (its demo text carries an email + a test card).
  await page.locator(".cd-file-card").filter({ hasText: "Product brief.docx" }).first().click();
  // Preview opens; reveal the compliance Details drawer.
  await page.getByTestId("preview-details-toggle").click();
  await expect(page.getByTestId("details-panel")).toBeVisible();

  await page.getByTestId("pii-scan-button").click();

  const results = page.getByTestId("pii-results");
  await expect(results).toBeVisible({ timeout: 5_000 });
  await expect(results).toContainText(/item.* of personal data found/);
  await expect(results).toContainText("Email address");
  await expect(results).toContainText("Payment card");
  // Masked previews are shown…
  await expect(results).toContainText("•••• 1111");
  // …and the raw values never are.
  await expect(results).not.toContainText("privacy@example.com");
  await expect(results).not.toContainText("4111 1111 1111 1111");
});

test("scanning a clean document reports no personal data", async ({ page }) => {
  // README.md is a supported (markdown) doc whose demo text carries no PII.
  await page.locator(".cd-file-card").filter({ hasText: "README.md" }).first().click();
  await page.getByTestId("preview-details-toggle").click();
  await expect(page.getByTestId("details-panel")).toBeVisible();

  await page.getByTestId("pii-scan-button").click();

  const results = page.getByTestId("pii-results");
  await expect(results).toBeVisible({ timeout: 5_000 });
  await expect(results).toContainText("No personal data detected");
});
