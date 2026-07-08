/**
 * Strict gate for the editor + preview chrome shipped in the
 * 2026-06-17 UX-EDITOR-* batch (PIPELINE.md "Editor & Preview UX
 * (premium quality bar)" theme). Every spec hits a zero-console-error
 * bar — any pageerror or unfiltered console.error fails the test.
 *
 * What this gate locks in:
 *   1. PreviewModal Expand button → /file/<id>            (UX-EDITOR-6)
 *   2. /file/<id> header has Share + kebab + filename     (UX-EDITOR-4)
 *   3. Filename inline rename round-trips                 (UX-EDITOR-4)
 *   4. SaveStatusPill testid mounts (idle state — no save fires
 *      against the demo's empty blobs, but the host shell is wired)
 *   5. Sheet editor at /file/<id> mounts <CasualSheets> natively, which
 *      renders the FULL editor chrome itself (menu bar + formatting toolbar +
 *      formula bar); Drive does not hand-roll a toolbar  (UX-EDITOR-1)
 *   6. Doc preview shows the friendly "Couldn't load preview" card
 *      instead of the SDK's red parse-error UI             (UX-EDITOR-5)
 *   7. Sheet preview shows the same friendly card          (UX-EDITOR-5)
 *
 * Future regressions land here, not in the per-PR visual specs.
 */
import { expect, test, type Page } from "@playwright/test";

import { resetDemoState, signInDemo } from "./_helpers.ts";

function attachStrictErrorListener(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`[console.error] ${m.text()}`);
  });
  (page as unknown as { __strictErrors__: string[] }).__strictErrors__ = errors;
}

test.beforeEach(async ({ page }) => {
  await resetDemoState(page);
  await signInDemo(page);
  attachStrictErrorListener(page);
});

// Errors the strict gate intentionally ignores — both originate
// inside the SDK iframe and are already surfaced to users via
// Drive's FailureFallback. They're not actionable from the host.
const IGNORED_ERROR_FRAGMENTS = [
  // Chromium sandboxing warning fires on every same-origin iframe
  // load; we can't influence it.
  "allow-scripts and allow-same-origin",
  // doc SDK logs parseDocx failures to console even when the host
  // wire's `onError` already reports them — redundant noise.
  "[parseDocx]",
  // sheet SDK's parser worker logs xlsx parse failures similarly.
  "Failed to load workbook",
  // ExcelJS internal stack — printed by the same parser worker.
  "End of data reached",
];

test.afterEach(async ({ page }) => {
  const errors = (page as unknown as { __strictErrors__: string[] }).__strictErrors__ ?? [];
  const filtered = errors.filter((e) => !IGNORED_ERROR_FRAGMENTS.some((s) => e.includes(s)));
  if (filtered.length) {
    throw new Error(`Strict errors captured:\n${filtered.join("\n")}`);
  }
});

async function openSheetEditor(page: Page) {
  await page.getByRole("button", { name: /^New$/ }).click();
  await page.getByRole("menuitem", { name: /New spreadsheet/i }).click();
  await page.waitForTimeout(2_000);
  const card = page.locator(".cd-file-card").filter({ hasText: /Untitled spreadsheet/i });
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await page.getByRole("button", { name: /Open in editor/i }).click();
  // P2.1 made `/document/<id>/edit` the canonical editor route; `/file/<id>`
  // survives as a compatibility alias. Accept either.
  await expect(page).toHaveURL(/\/(file|document)\//, { timeout: 10_000 });
  await page.getByTestId("file-fullscreen").waitFor({ timeout: 15_000 });
}

test("UX-EDITOR-6: PreviewModal Expand button routes to fullscreen", async ({ page }) => {
  test.setTimeout(45_000);
  await page.getByText("Q2 planning.xlsx").first().click();
  await page.getByTestId("preview-expand").waitFor();
  await page.getByTestId("preview-expand").click();
  // Canonical `/document/<id>/edit` (P2.1); `/file/<id>` alias also valid.
  await expect(page).toHaveURL(/\/(file|document)\//, { timeout: 5_000 });
  await page.getByTestId("file-fullscreen").waitFor();
});

test("UX-EDITOR-4: /file/<id> header chrome — Share + kebab + filename", async ({ page }) => {
  test.setTimeout(60_000);
  await openSheetEditor(page);
  await expect(page.getByTestId("file-fullscreen-share")).toBeVisible();
  await expect(page.getByTestId("file-fullscreen-back")).toBeVisible();
  await expect(page.getByTestId("file-fullscreen-title")).toBeVisible();
  await expect(page.getByRole("button", { name: /More actions/i })).toBeVisible();
});

test("UX-EDITOR-4: filename inline rename round-trips through PATCH", async ({ page }) => {
  test.setTimeout(60_000);
  await openSheetEditor(page);
  await page.getByTestId("file-fullscreen-title").click();
  const input = page.getByTestId("file-fullscreen-title-input");
  await input.waitFor();
  await input.fill("Renamed by gate.xlsx");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("file-fullscreen-title")).toHaveText("Renamed by gate.xlsx");
});

test("UX-EDITOR-1: sheet editor renders the SDK's full chrome natively", async ({ page }) => {
  test.setTimeout(60_000);
  await openSheetEditor(page);
  // The package IS the editor (Excalidraw model): the SDK renders the full
  // chrome — menu bar, formatting toolbar, formula bar — directly in Drive's
  // tree (no iframe). Drive only frames it; there is NO Drive-side toolbar.
  await expect(page.getByTestId("sheet-toolbar")).toHaveCount(0);
  const workspace = page.getByTestId("casual-sheet-workspace");
  await expect(workspace).toBeVisible({ timeout: 15_000 });
  await expect(workspace.getByTestId("cs-menubar")).toBeVisible({ timeout: 20_000 });
  await expect(workspace.getByTestId("cs-namebox-input")).toBeVisible();
  // The Univer grid canvas paints directly on the page.
  await expect
    .poll(() => workspace.locator("canvas").count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
});

test("UX-EDITOR-5: docx preview shows friendly fallback instead of parse error", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.getByText("Product brief.docx").first().click();
  // The demo's seeded blob is empty → SDK fires casual.error
  // → ErrorAwareDoc swaps the iframe for FailureFallback. The M5 preview
  // restyle worded the friendly card "Couldn't load the preview." — match
  // with or without the article.
  await expect(page.getByText(/Couldn't load.*preview/i)).toBeVisible({
    timeout: 15_000,
  });
  // The SDK's own red "Failed to Load Document" UI must NOT show.
  await expect(page.getByText(/Failed to Load Document/i)).toHaveCount(0);
});

test("UX-EDITOR-5: xlsx preview shows friendly fallback instead of parse error", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.getByText("Q2 planning.xlsx").first().click();
  await expect(page.getByText(/Couldn't load.*preview/i)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(/Failed to load workbook/i)).toHaveCount(0);
});

test("UX-EDITOR-8 phase 2: FileFullscreen Details pill opens drawer with same panel", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openSheetEditor(page);
  await expect(page.getByTestId("file-fullscreen-details")).toBeVisible();
  await page.getByTestId("file-fullscreen-details").click();
  await page.getByTestId("file-fullscreen-details-drawer").waitFor({ timeout: 5_000 });
  await expect(page.getByTestId("details-panel")).toBeVisible();
  await expect(page.getByTestId("details-compliance-card")).toBeVisible();
  // Esc closes the drawer
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("file-fullscreen-details-drawer")).toHaveCount(0);
});

test("UX-EDITOR-8: PreviewModal Details card shows compliance summary + links", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.getByText("Q2 planning.xlsx").first().click();
  // M6/ui-v3 §3.2 made the Details panel opt-in: the modal opens as a
  // single-column stage with the proof one-liner; the full compliance
  // card discloses behind the footer "Details" toggle.
  await expect(page.getByText(/Encrypted · v\d+ · ✓ Verified/)).toBeVisible({ timeout: 5_000 });
  await page.getByTestId("preview-details-toggle").click();
  await page.getByTestId("details-panel").waitFor({ timeout: 5_000 });
  // Scope the button assertions to the card — the modal chrome has its own actions.
  const card = page.getByTestId("details-compliance-card");
  await expect(card).toBeVisible();
  await expect(card.getByRole("button", { name: /View full history/i })).toBeVisible();
  await expect(card.getByRole("button", { name: /Share/i })).toBeVisible();
});

test("UX-EDITOR-8: Details compliance card links to full version history", async ({ page }) => {
  test.setTimeout(60_000);
  await page.getByText("Q2 planning.xlsx").first().click();
  // Details is opt-in (§3.2) — reveal the card, then follow its primary link.
  await page.getByTestId("preview-details-toggle").click();
  await page.getByTestId("details-panel").waitFor({ timeout: 5_000 });
  // The card's primary action is the ONE canonical version-history home.
  await page.getByRole("button", { name: /View full history/i }).click();
  await expect(page).toHaveURL(/\/document\/.*\/history/);
  // The full route's panel primary — always present on the history surface.
  await expect(page.getByRole("button", { name: /Verify chain/i })).toBeVisible();
});

// NB: the former "UX-EDITOR-7: video preview mounts the vidstack player"
// gate is intentionally removed. Video is out of the documents-only product
// scope (CLAUDE.md — the ingest allowlist has no media types); the vidstack
// player and its 'cd-media-shell--video' shell were dropped, and the demo's
// "Demo walkthrough.mp4" seed removed with it. No video renderer to gate.

// NB: the former "UX-EDITOR-2: iframe stays light-themed under
// prefers-color-scheme:dark" gate is intentionally removed. It locked in
// copy-embed's theme-lock shim (an inline MutationObserver pinning
// data-theme="light"), which was a workaround for pre-0.11 embed builds.
// The rewritten copy-embed copies the SDK's clean embed runtimes verbatim
// with no HTML patching, so there's no host-injected theme lock to assert.
// Host-driven theming will return as an explicit `casual.command.set.theme`
// wire (the protocol already defines it) once Drive ships a theme toggle.
