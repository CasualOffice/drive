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

/**
 * Anti-bleed guard. After an editor mounts, the docs SDK stylesheet
 * (`@casualoffice/docs/dist/styles.css`) has lazy-injected its own full
 * design-token set on a plain `:root {}`, using canonical names that overlap
 * Drive's (--font-sans, --space-*, --radius-*, --text-*, --ease-*, …) but with
 * the SDK's palette. Drive defines those on `html:root` (specificity 0,1,1) so
 * it stays authoritative regardless of injection order. This asserts Drive's
 * signal accent is still VIOLET #8B5CF6 (the neobrutalist redesign's signal —
 * previously amber) and that a representative SDK-overlapping token still
 * resolves to Drive's value, i.e. the SDK sheet did not repaint the chrome.
 */
// Drive's signal violet — theme-aware (the redesign brightens it on dark "Ink").
// Both are Drive's own values; neither is the SDK's cyan.
const DRIVE_VIOLET = { light: "#8b5cf6", dark: "#9b6cff" } as const;

/**
 * P6 neobrutalist-chrome guard. The Drive-owned editor chrome (back button,
 * Share button, save pill) must carry the redesign's signature: a 2px solid
 * ink border. This asserts the resolved `border-width` on the back + share
 * buttons is 2px (i.e. `--border-w`, not a leftover 1px hairline) so the
 * chrome reads as a first-class neobrutalist surface, not a soft transplant.
 */
async function assertNeobrutalChrome(page: Page) {
  const back = page.getByTestId("file-fullscreen-back");
  const share = page.getByTestId("file-fullscreen-share");
  for (const btn of [back, share]) {
    const bw = await btn.evaluate((el) => getComputedStyle(el).borderTopWidth);
    expect(bw).toBe("2px");
  }
  // The Share CTA carries Drive's violet signal fill.
  const shareBg = await share.evaluate((el) => getComputedStyle(el).backgroundColor);
  // rgb(139, 92, 246) light / rgb(155, 108, 255) dark — either is Drive's violet.
  expect(shareBg).toMatch(/rgb\((139|155),/);
}

/** Capture the fullscreen header strip (Drive-owned chrome) on its own so the
 *  restyled back/title/save-pill/presence/Details/Share read at a glance. */
async function shotHeader(page: Page, name: string) {
  const header = page.getByTestId("file-fullscreen-back").locator("xpath=ancestor::header[1]");
  await header.screenshot({ path: `${OUT}/${name}` }).catch(() => {});
}

async function assertNoSdkBleed(page: Page, theme: "light" | "dark") {
  const tokens = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      accent: cs.getPropertyValue("--accent").trim(),
      violet: cs.getPropertyValue("--violet-500").trim(),
      // SDK-overlapping token: Drive's radius scale (8px), not the SDK's.
      radiusSm: cs.getPropertyValue("--radius-sm").trim(),
      // SDK-overlapping token: Drive's Inter/Geist stack, not the SDK's.
      fontSans: cs.getPropertyValue("--font-sans").trim(),
    };
  });
  // Drive's signal accent is violet (redesign), resolved through --violet-500,
  // and --accent aliases it — proving the SDK sheet did not repaint the signal.
  expect(tokens.violet.toLowerCase()).toBe(DRIVE_VIOLET[theme]);
  expect(tokens.accent.toLowerCase()).toBe(DRIVE_VIOLET[theme]);
  // SDK-overlapping tokens still carry Drive's values (no cyan/SDK bleed).
  expect(tokens.radiusSm).toBe("8px");
  expect(tokens.fontSans).toMatch(/Inter/);
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
  await shotHeader(page, "docx-header-light.png");
  // With the docs SDK stylesheet now injected, Drive's chrome tokens must still
  // resolve to Drive's own values (violet signal, no SDK cyan bleed) in light.
  await assertNoSdkBleed(page, "light");
  // P6 — Drive-owned editor chrome carries the neobrutalist signature.
  await assertNeobrutalChrome(page);
  await setTheme(page, "dark");
  await page.screenshot({ path: `${OUT}/docx-editor-dark.png`, fullPage: false });
  await shotHeader(page, "docx-header-dark.png");
  // …and in dark (Drive brightens its own --violet-500 to #9b6cff; the
  // SDK-overlapping tokens still resolve to Drive's, not the SDK's, values).
  await assertNoSdkBleed(page, "dark");
  await assertNeobrutalChrome(page);

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
  await shotHeader(page, "xlsx-header-light.png");
  await assertNeobrutalChrome(page);
  await setTheme(page, "dark");
  await page.screenshot({ path: `${OUT}/xlsx-editor-dark.png`, fullPage: false });
  await shotHeader(page, "xlsx-header-dark.png");
  await assertNeobrutalChrome(page);

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
