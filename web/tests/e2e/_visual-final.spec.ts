import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resetDemoState, signInDemo } from "./_helpers.ts";
mkdirSync("/tmp/drive-final-visual", { recursive: true });

test.beforeEach(async ({ page }) => {
  await resetDemoState(page);
  await signInDemo(page);
});

async function newAndOpen(
  page: import("@playwright/test").Page,
  kind: "spreadsheet" | "document",
) {
  await page.getByRole("button", { name: /^New$/ }).click();
  const menuItem =
    kind === "spreadsheet" ? /New spreadsheet/i : /^New document$/i;
  await page.getByRole("menuitem", { name: menuItem }).click();
  await page.waitForTimeout(2_000);
  const cardText =
    kind === "spreadsheet"
      ? /Untitled spreadsheet/i
      : /Untitled \d+\.docx/i;
  const card = page.locator(".cd-file-card").filter({ hasText: cardText });
  await card.scrollIntoViewIfNeeded();
  await card.click();
}

test("xlsx editor", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1400, height: 900 });
  await newAndOpen(page, "spreadsheet");
  await page.getByTestId("casual-sheet-workspace").waitFor();
  await page.waitForTimeout(15_000);
  await page.screenshot({
    path: "/tmp/drive-final-visual/01-editor-xlsx.png",
    fullPage: false,
  });
});

test("docx editor", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1400, height: 900 });
  await newAndOpen(page, "document");
  await page.getByTestId("casual-doc-editor").waitFor();
  await page.waitForTimeout(15_000);
  await page.screenshot({
    path: "/tmp/drive-final-visual/02-editor-docx.png",
    fullPage: false,
  });
});
