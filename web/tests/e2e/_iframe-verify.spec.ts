/**
 * Strict iframe verification — no permissive .or() chains, real console
 * error listeners, real visual mode assertions. If anything is broken
 * the test fails loud.
 */
import { expect, test } from "@playwright/test";

import { resetDemoState, signInDemo } from "./_helpers.ts";

const IGNORED_CONSOLE_PATTERNS: RegExp[] = [
  // React DevTools nag.
  /Download the React DevTools/i,
  // Vite HMR informational logs.
  /\[vite\]/i,
];

function shouldIgnore(text: string): boolean {
  return IGNORED_CONSOLE_PATTERNS.some((re) => re.test(text));
}

interface Capture {
  source: "console.error" | "pageerror";
  text: string;
}

function installErrorListener(page: import("@playwright/test").Page): Capture[] {
  const errors: Capture[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (shouldIgnore(text)) return;
    errors.push({ source: "console.error", text });
  });
  page.on("pageerror", (err) => {
    const text = err.message;
    if (shouldIgnore(text)) return;
    errors.push({ source: "pageerror", text });
  });
  return errors;
}

test.beforeEach(async ({ page }) => {
  await resetDemoState(page);
  await signInDemo(page);
});

test("templates fetch returns 200 (not 404)", async ({ page }) => {
  const xlsx = await page.request.get(`/templates/blank.xlsx`);
  expect(xlsx.status()).toBe(200);
  const docx = await page.request.get(`/templates/blank.docx`);
  expect(docx.status()).toBe(200);
});

test("doc embed runtime is reachable at /embed/docs", async ({ page }) => {
  // The SHEET editor no longer uses the iframe path — Drive direct-mounts
  // <CasualSheets chrome="full">, so there is no /embed/sheets/. Only the
  // docx editor still ships via the self-contained iframe runtime.
  const docHtml = await page.request.get(`/embed/docs/embed.html`);
  expect(docHtml.status()).toBe(200);
  const docRuntime = await page.request.get(`/embed/docs/embed-runtime.mjs`);
  expect(docRuntime.status()).toBe(200);
});

test("create new .xlsx → card double-click routes to /file/<id> + direct-mount editor", async ({ page }) => {
  const errors = installErrorListener(page);

  // Click New → New spreadsheet
  await page.getByRole("button", { name: /^New$/ }).click();
  await page.getByRole("menuitem", { name: /New spreadsheet/i }).click();

  // Wait for the success toast then wait for it to clear so it
  // doesn't intercept the file-card click.
  await expect(page.getByText(/Created Untitled spreadsheet/i)).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByText(/Created Untitled spreadsheet/i)).toBeHidden({
    timeout: 8_000,
  });

  // Double-click the new file card — single click opens the preview
  // modal (every file type), double click opens the editor route.
  const card = page.locator(".cd-file-card").filter({ hasText: /Untitled spreadsheet/i });
  await card.scrollIntoViewIfNeeded();
  await card.dblclick();

  await expect(page).toHaveURL(/\/file\//, { timeout: 5_000 });

  // Sheet is now a DIRECT React mount of <CasualSheets chrome="full"> — a
  // plain container, not an iframe. The blank.xlsx template parses, so the
  // workspace reaches its ready state and the SDK's own Office chrome
  // (toolbar / formula bar / sheet tabs) renders inside.
  const workspace = page.getByTestId("casual-sheet-workspace");
  await expect(workspace).toBeVisible({ timeout: 15_000 });

  // Give the editor a beat to boot Univer + paint the chrome.
  await page.waitForTimeout(2_000);

  // No console errors / page errors during the mount.
  if (errors.length > 0) {
    throw new Error(
      `Browser captured ${errors.length} error(s) during editor mount:\n` +
        errors.map((e) => `  [${e.source}] ${e.text}`).join("\n"),
    );
  }
});

test("create new .docx → card double-click routes to /file/<id> + editor iframe", async ({ page }) => {
  const errors = installErrorListener(page);

  await page.getByRole("button", { name: /^New$/ }).click();
  await page.getByRole("menuitem", { name: /^New document$/i }).click();
  await expect(page.getByText(/Created Untitled/i)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(/Created Untitled/i)).toBeHidden({ timeout: 8_000 });

  const card = page.locator(".cd-file-card").filter({ hasText: /Untitled \d+\.docx/i });
  await card.scrollIntoViewIfNeeded();
  await card.dblclick();

  await expect(page).toHaveURL(/\/file\//, { timeout: 5_000 });
  const iframe = page.getByTestId("casual-doc-editor");
  await expect(iframe).toBeVisible({ timeout: 10_000 });
  await expect(iframe).toHaveAttribute("src", /viewMode=editor/);

  await page.waitForTimeout(2_000);

  if (errors.length > 0) {
    throw new Error(
      `Browser captured ${errors.length} error(s) during editor mount:\n` +
        errors.map((e) => `  [${e.source}] ${e.text}`).join("\n"),
    );
  }
});

test("card double-click on a .xlsx → /file/<id> direct-mounts the editor", async ({ page }) => {
  await page.getByRole("button", { name: /^New$/ }).click();
  await page.getByRole("menuitem", { name: /New spreadsheet/i }).click();
  await expect(page.getByText(/Created Untitled spreadsheet/i)).toBeHidden({
    timeout: 8_000,
  });

  const card = page.locator(".cd-file-card").filter({ hasText: /Untitled spreadsheet/i });
  await card.scrollIntoViewIfNeeded();
  await card.dblclick();

  await expect(page).toHaveURL(/\/file\//, { timeout: 5_000 });

  // Direct mount — a container div, not an iframe with a viewMode src.
  const workspace = page.getByTestId("casual-sheet-workspace");
  await expect(workspace).toBeVisible({ timeout: 15_000 });
});
