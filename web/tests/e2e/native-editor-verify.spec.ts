/**
 * Native-editor verification — both editors mount in-app (no iframe seam).
 *
 * Post P1 (docs) + P2 (sheets), Drive renders `<CasualEditor>` and
 * `<CasualSheets>` directly into its own React tree; the bespoke iframe hosts
 * (`CasualEditorIframe`, `SheetEmbed`) and the `public/embed/` runtimes copied
 * by `scripts/copy-embed.mjs` are all retired. This suite locks in that the
 * native mounts actually paint — the sheet's Univer grid canvas and the doc's
 * editor surface — reached only when a file is opened.
 *
 * Note on console errors: the Univer/ProseMirror editors now run in the MAIN
 * page (not a sandboxed iframe), so their own dev-time console noise reaches
 * `page.on('console')`. We only fail on errors that look like OUR integration
 * breaking (unhandled bridge/import failures), not third-party editor chatter.
 */
import { expect, test } from "@playwright/test";

import { resetDemoState, signInDemo } from "./_helpers.ts";

const IGNORED_CONSOLE_PATTERNS: RegExp[] = [
  /Download the React DevTools/i,
  /\[vite\]/i,
  // Univer + its plugins emit dev warnings/telemetry through console.error
  // (deprecations, optional-feature probes, resource-load timing). None of
  // these are our integration failing.
  /univer/i,
  /@univerjs/i,
  /rxjs/i,
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

test("create new .xlsx → card double-click routes to editor + native grid canvas paints", async ({
  page,
}) => {
  const errors = installErrorListener(page);

  // New → New spreadsheet
  await page.getByRole("button", { name: /^New$/ }).click();
  await page.getByRole("menuitem", { name: /New spreadsheet/i }).click();

  await expect(page.getByText(/Created Untitled spreadsheet/i)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(/Created Untitled spreadsheet/i)).toBeHidden({ timeout: 8_000 });

  const card = page.locator(".cd-file-card").filter({ hasText: /Untitled spreadsheet/i });
  await card.scrollIntoViewIfNeeded();
  await card.dblclick();

  await expect(page).toHaveURL(/\/(file|document)\//, { timeout: 5_000 });

  // Sheet mounts natively — the CasualSheets container renders directly in
  // Drive's tree (no iframe).
  const workspace = page.getByTestId("casual-sheet-workspace");
  await expect(workspace).toBeVisible({ timeout: 15_000 });

  // The blank.xlsx template parses + imports, so Univer paints its grid canvas
  // directly on the page. Poll rather than sleep — the wasm render engine's
  // first paint time varies under parallel load.
  await expect
    .poll(() => page.locator('[data-testid="casual-sheet-workspace"] canvas').count(), {
      timeout: 20_000,
    })
    .toBeGreaterThan(0);

  if (errors.length > 0) {
    throw new Error(
      `Browser captured ${errors.length} integration error(s) during sheet mount:\n` +
        errors.map((e) => `  [${e.source}] ${e.text}`).join("\n"),
    );
  }
});

test("create new .docx → card double-click mounts the native doc editor", async ({ page }) => {
  const errors = installErrorListener(page);

  await page.getByRole("button", { name: /^New$/ }).click();
  await page.getByRole("menuitem", { name: /^New document$/i }).click();
  await expect(page.getByText(/Created Untitled/i)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(/Created Untitled/i)).toBeHidden({ timeout: 8_000 });

  const card = page.locator(".cd-file-card").filter({ hasText: /Untitled \d+\.docx/i });
  await card.scrollIntoViewIfNeeded();
  await card.dblclick();

  await expect(page).toHaveURL(/\/(file|document)\//, { timeout: 5_000 });
  // Native mount: a real DOM container (no iframe / no `src`).
  await expect(page.getByTestId("casual-doc-editor")).toBeVisible({ timeout: 10_000 });

  await page.waitForTimeout(2_000);

  if (errors.length > 0) {
    throw new Error(
      `Browser captured ${errors.length} integration error(s) during doc mount:\n` +
        errors.map((e) => `  [${e.source}] ${e.text}`).join("\n"),
    );
  }
});

test("single-click a real .xlsx → preview modal mounts the read-only grid", async ({ page }) => {
  // Preview ⇒ mode="preview" ⇒ documentMode="viewing" + chrome="none": the SDK
  // renders just the read-only grid (no menu bar / toolbar). Use a freshly
  // created sheet (real blank.xlsx template bytes) — the demo's seeded
  // Q2 planning.xlsx ships zero bytes and takes the friendly-fallback path
  // (covered by the _chrome-gate UX-EDITOR-5 spec).
  await page.getByRole("button", { name: /^New$/ }).click();
  await page.getByRole("menuitem", { name: /New spreadsheet/i }).click();
  await expect(page.getByText(/Created Untitled spreadsheet/i)).toBeHidden({ timeout: 8_000 });

  const card = page.locator(".cd-file-card").filter({ hasText: /Untitled spreadsheet/i });
  await card.scrollIntoViewIfNeeded();
  await card.click();

  const workspace = page.getByTestId("casual-sheet-workspace");
  await expect(workspace).toBeVisible({ timeout: 15_000 });
  // Read-only grid paints, but the editor chrome (menu bar) is hidden.
  await expect
    .poll(() => workspace.locator("canvas").count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
  await expect(workspace.getByTestId("cs-menubar")).toHaveCount(0);
});
