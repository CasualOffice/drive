import { expect, test } from "@playwright/test";
import { resetDemoState, signInDemo } from "./_helpers.ts";

test.beforeEach(async ({ page }) => {
  await resetDemoState(page);
  await signInDemo(page);
  // Into Settings → Tokens & sessions.
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Tokens & sessions" }).click();
  await expect(
    page.getByRole("heading", { name: "Tokens & sessions" }),
  ).toBeVisible();
});

test("create a token, see it once, then revoke it", async ({ page }) => {
  // Empty state to start.
  await expect(page.getByText("No tokens yet.", { exact: false })).toBeVisible();

  await page.getByLabel("Name").fill("laptop CLI");
  await page.getByRole("button", { name: /Create token/i }).click();

  // The plaintext is revealed exactly once, prefixed.
  const fresh = page.getByTestId("fresh-token");
  await expect(fresh).toBeVisible({ timeout: 5_000 });
  await expect(fresh).toContainText("dh_pat_");

  // It shows in the list as active.
  const row = page.locator("li", { hasText: "laptop CLI" }).first();
  await expect(row).toBeVisible();
  await expect(row.getByText("Active")).toBeVisible();

  // Revoke it → status flips, the Revoke control goes away.
  await row.getByTestId("revoke-token").click();
  await expect(row.getByText("Revoked")).toBeVisible({ timeout: 5_000 });
  await expect(row.getByTestId("revoke-token")).toHaveCount(0);
});

test("a blank name can't create a token", async ({ page }) => {
  // The create button stays disabled until a name is entered.
  const create = page.getByRole("button", { name: /Create token/i });
  await expect(create).toBeDisabled();
  await page.getByLabel("Name").fill("ci runner");
  await expect(create).toBeEnabled();
});
