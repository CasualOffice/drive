import { expect, test } from "@playwright/test";
import { resetDemoState, signInDemo } from "./_helpers.ts";

test.beforeEach(async ({ page }) => {
  await resetDemoState(page);
});

test("a failed lazy-chunk load is caught by the boundary, not a white screen", async ({
  page,
}) => {
  await signInDemo(page);

  // Simulate a stale client after a redeploy: the old Notes chunk hash no
  // longer resolves. Aborting the request makes the dynamic import() reject —
  // Suspense does NOT catch load errors, so without a boundary this would
  // white-screen the whole SPA.
  await page.route(/Notes-.*\.js(\?.*)?$/, (route) => route.abort());

  // Navigate to the lazily-loaded Notes surface.
  await page.getByRole("button", { name: "Notes" }).click();

  // The boundary renders a recoverable fallback instead of a blank page.
  await expect(page.getByText(/a new version is available/i)).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();

  // The chrome survived — only the inner surface failed. The sidebar nav
  // (a sibling of the boundary) is still interactive, which is the whole
  // point of scoping the boundary to the routed <main> rather than the app.
  await expect(page.getByRole("button", { name: "Notes" })).toBeVisible();

  // Switching to another surface clears the caught error (resetKey=nav) and
  // remounts cleanly — the fallback is gone and My Drive renders.
  await page.getByRole("button", { name: "My Drive" }).click();
  await expect(page.getByText(/a new version is available/i)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "My Drive" })).toBeVisible({
    timeout: 10_000,
  });
});

test("a failed editor chunk on the full-screen route offers a way back to Drive", async ({
  page,
}) => {
  await signInDemo(page);

  // Break the doc-editor chunk — the heaviest, most-likely-to-fail lazy load.
  await page.route(/CasualDocEditor-.*\.js(\?.*)?$/, (route) => route.abort());

  // Create a document and open it full-screen (routes outside the Shell).
  await page.getByRole("button", { name: /^New$/ }).click();
  await page.getByRole("menuitem", { name: /^New document$/i }).click();
  await expect(page.getByText(/Created Untitled/i)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(/Created Untitled/i)).toBeHidden({ timeout: 8_000 });

  const card = page.locator(".cd-file-card").filter({ hasText: /Untitled \d+\.docx/i });
  await card.scrollIntoViewIfNeeded();
  await card.dblclick();
  await expect(page).toHaveURL(/\/(file|document)\//, { timeout: 5_000 });

  // The editor chunk fails to load; the route boundary catches it and — unlike
  // the app-level "reload only" net — gives an escape back to the Drive.
  await expect(page.getByText(/a new version is available/i)).toBeVisible({
    timeout: 15_000,
  });
  const back = page.getByRole("button", { name: "Back to Drive" });
  await expect(back).toBeVisible();

  await back.click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 10_000 });
});
