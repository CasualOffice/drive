/**
 * P5 visual verification — native-feel repolish.
 *
 * Opens a real .docx and .xlsx (created from the blank templates, which carry
 * real bytes that parse) in BOTH editor mode (fullscreen route) and preview
 * mode (single-click modal), in BOTH light and dark, and saves a screenshot of
 * each to test-results/p5/. The screenshots are the artefact the P5 report
 * reasons over: editor canvas renders, Drive's chrome surrounds it, dark mode
 * actually applies to the editor (not white-on-dark / dark-on-white), and no
 * obvious CSS clash between the SDK stylesheets and Drive's chrome.
 *
 * Note: the docs editor keeps the document PAGE white even in dark mode (that
 * is correct — Google Docs does the same; only the chrome/gutter/toolbar go
 * dark). So "dark applied" here means the surrounding editor chrome + gutter
 * darken, with a white paper sheet — not a fully-black canvas.
 */
import { expect, test, type Page } from "@playwright/test";

import { resetDemoState, signInDemo } from "./_helpers.ts";

const OUT = "test-results/p5";

async function setTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((t) => {
    document.documentElement.setAttribute("data-theme", t);
  }, theme);
  // Let the mounts' MutationObservers re-theme + Univer repaint.
  await page.waitForTimeout(600);
}

async function newFile(page: Page, item: RegExp, createdToast: RegExp) {
  await page.getByRole("button", { name: /^New$/ }).click();
  await page.getByRole("menuitem", { name: item }).click();
  await expect(page.getByText(createdToast)).toBeHidden({ timeout: 8_000 });
}

test.beforeEach(async ({ page }) => {
  await resetDemoState(page);
  await signInDemo(page);
});

test("docx — editor + preview, light + dark", async ({ page }) => {
  await newFile(page, /^New document$/i, /Created Untitled/i);

  // ── Editor (fullscreen) ──
  const card = page.locator(".cd-file-card").filter({ hasText: /Untitled \d+\.docx/i });
  await card.scrollIntoViewIfNeeded();
  await card.dblclick();
  await expect(page).toHaveURL(/\/(file|document)\//, { timeout: 5_000 });
  await expect(page.getByTestId("casual-doc-editor")).toBeVisible({ timeout: 15_000 });
  // The editor actually painted its ProseMirror surface (a real document page).
  await expect
    .poll(() => page.locator('[data-testid="casual-doc-editor"] .ep-root, [data-testid="casual-doc-editor"] [contenteditable]').count(), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
  // Drive's own fullscreen chrome surrounds the editor.
  await expect(page.getByTestId("file-fullscreen-back")).toBeVisible();
  await expect(page.getByTestId("file-fullscreen-share")).toBeVisible();

  await setTheme(page, "light");
  await page.screenshot({ path: `${OUT}/docx-editor-light.png`, fullPage: false });
  await setTheme(page, "dark");
  await page.screenshot({ path: `${OUT}/docx-editor-dark.png`, fullPage: false });

  // The editor wrapper reflects the resolved theme (item 1a — docs SDK follows
  // Drive's dark via the wrapper's data-theme, incl. the scoped path).
  await expect(page.getByTestId("casual-doc-editor")).toHaveAttribute("data-theme", "dark");

  // ── Preview (single-click modal) ──
  await page.getByTestId("file-fullscreen-back").click();
  await expect(page.getByRole("button", { name: /^New$/ })).toBeVisible();
  await setTheme(page, "light");
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await expect(page.getByTestId("casual-doc-editor")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: `${OUT}/docx-preview-light.png` });
  await setTheme(page, "dark");
  await page.screenshot({ path: `${OUT}/docx-preview-dark.png` });
});

test("xlsx — editor + preview, light + dark", async ({ page }) => {
  await newFile(page, /New spreadsheet/i, /Created Untitled spreadsheet/i);

  // ── Editor (fullscreen) ──
  const card = page.locator(".cd-file-card").filter({ hasText: /Untitled spreadsheet/i });
  await card.scrollIntoViewIfNeeded();
  await card.dblclick();
  await expect(page).toHaveURL(/\/(file|document)\//, { timeout: 5_000 });
  const workspace = page.getByTestId("casual-sheet-workspace");
  await expect(workspace).toBeVisible({ timeout: 15_000 });
  // Univer grid canvas paints.
  await expect
    .poll(() => workspace.locator("canvas").count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
  await expect(page.getByTestId("file-fullscreen-back")).toBeVisible();

  await setTheme(page, "light");
  await page.screenshot({ path: `${OUT}/xlsx-editor-light.png`, fullPage: false });
  await setTheme(page, "dark");
  await page.screenshot({ path: `${OUT}/xlsx-editor-dark.png`, fullPage: false });

  // ── Preview (single-click modal) ──
  await page.getByTestId("file-fullscreen-back").click();
  await expect(page.getByRole("button", { name: /^New$/ })).toBeVisible();
  await setTheme(page, "light");
  await card.scrollIntoViewIfNeeded();
  await card.click();
  const previewWs = page.getByTestId("casual-sheet-workspace");
  await expect(previewWs).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => previewWs.locator("canvas").count(), { timeout: 20_000 }).toBeGreaterThan(0);
  await page.screenshot({ path: `${OUT}/xlsx-preview-light.png` });
  await setTheme(page, "dark");
  await page.screenshot({ path: `${OUT}/xlsx-preview-dark.png` });
});
