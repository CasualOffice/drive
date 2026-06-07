import { expect, test } from "@playwright/test";
import { resetDemoState, signInDemo } from "./_helpers.ts";

test.beforeEach(async ({ page }) => {
  await resetDemoState(page);
  await signInDemo(page);
});

test("`?` opens the keyboard-shortcut help modal", async ({ page }) => {
  await page.keyboard.press("Shift+/");
  await expect(page.getByRole("heading", { name: "Keyboard shortcuts" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Keyboard shortcuts" })).toBeHidden();
});

test("the help button in the top bar also opens the modal", async ({ page }) => {
  await page.getByRole("button", { name: /keyboard shortcuts/i }).click();
  await expect(page.getByRole("heading", { name: "Keyboard shortcuts" })).toBeVisible();
});

test("the notifications bell opens its dropdown and shows seeded events", async ({ page }) => {
  await page.getByRole("button", { name: "Notifications" }).click();
  // Demo seeds a share.access event for "Q2 planning.xlsx".
  await expect(page.getByText(/Someone opened/)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(/View all activity/)).toBeVisible();
});

test("clicking 'View all activity' routes to the Activity tab", async ({ page }) => {
  await page.getByRole("button", { name: "Notifications" }).click();
  await page.getByText(/View all activity/).click();
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
});

test("Admin tab loads the system snapshot", async ({ page }) => {
  // Sidebar nav-row buttons are role=button with the label as text.
  await page.getByRole("button").filter({ hasText: /^Admin$/ }).first().click();
  await expect(page.getByRole("heading", { name: "Admin", exact: true })).toBeVisible();
  await expect(page.getByText(/Healthy/)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(/Active sessions/)).toBeVisible();
});
