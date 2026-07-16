import { expect, test } from "@playwright/test";
import { resetDemoState, signInDemo } from "./_helpers.ts";

// Keyboard operability for the Files grid/list (a11y). The grid is an ARIA
// listbox of focusable options; a single container handler moves focus with
// the arrow keys, opens with Enter, and toggles selection with Space — without
// disturbing the existing mouse drag-to-move + Cmd/Shift multi-select.

test.beforeEach(async ({ page }) => {
  await resetDemoState(page);
  await signInDemo(page);
});

test("arrow keys move focus between grid items", async ({ page }) => {
  const items = page.locator("[data-entry-id]");
  await expect(items.first()).toBeVisible();

  // Focus the first item directly (Tab order to reach the grid is long and
  // brittle; the point under test is the container's arrow handling).
  await items.first().focus();
  const firstId = await page.evaluate(
    () => document.activeElement?.getAttribute("data-entry-id") ?? null,
  );
  expect(firstId).not.toBeNull();

  // ArrowRight advances to the next item…
  await page.keyboard.press("ArrowRight");
  const secondId = await page.evaluate(
    () => document.activeElement?.getAttribute("data-entry-id") ?? null,
  );
  expect(secondId).not.toBeNull();
  expect(secondId).not.toBe(firstId);

  // …and ArrowLeft returns to it. Movement is symmetric and never wraps.
  await page.keyboard.press("ArrowLeft");
  const backId = await page.evaluate(
    () => document.activeElement?.getAttribute("data-entry-id") ?? null,
  );
  expect(backId).toBe(firstId);
});

test("Space toggles selection and stacks into multi-select", async ({ page }) => {
  const items = page.locator("[data-entry-id]");
  await expect(items.first()).toBeVisible();

  await items.first().focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("region", { name: /selected/i })).toBeVisible();
  await expect(page.getByText("1 selected")).toBeVisible();

  // Move and select a second — keyboard select stacks like Cmd-click.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Space");
  await expect(page.getByText("2 selected")).toBeVisible();

  // Space again on the focused item deselects it (toggle).
  await page.keyboard.press("Space");
  await expect(page.getByText("1 selected")).toBeVisible();

  // Escape clears the whole selection (unchanged global shortcut).
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: /selected/i })).toBeHidden();
});

test("Enter opens the focused entry", async ({ page }) => {
  // Focus the Projects folder card and press Enter → it opens (enters the
  // folder), same as a double-click. Folders avoid mounting an editor SDK,
  // keeping the assertion deterministic.
  const folder = page.locator(".cd-folder-card").filter({ hasText: "Projects" });
  await expect(folder).toBeVisible();
  await folder.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
});

test("keyboard focus does not break mouse multi-select", async ({ page }) => {
  // Regression guard: the roving-focus wiring must not disturb the existing
  // Cmd-click multi-select path.
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.getByText("README.md").first().click({ modifiers: [modifier] });
  await page.getByText("Q2 planning.xlsx").first().click({ modifiers: [modifier] });
  await expect(page.getByText("2 selected")).toBeVisible();
});
