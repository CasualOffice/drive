import { expect, test } from "@playwright/test";
import { resetDemoState, signInDemo } from "./_helpers.ts";

test.beforeEach(async ({ page }) => {
  await resetDemoState(page);
});

test("sign-in page pre-fills demo credentials and renders the brand", async ({ page }) => {
  await page.goto("/");
  // M4 branding sweep renamed Casual Drive → Doc-Hub.
  await expect(page.getByRole("heading", { name: "Doc-Hub" })).toBeVisible();
  await expect(page.getByPlaceholder("Username")).toHaveValue("demo");
  await expect(page.getByPlaceholder("Password")).toHaveValue("demo");
});

test("signing in lands on the shell with the seeded items visible", async ({ page }) => {
  await signInDemo(page);
  // Sidebar nav + brand wordmark.
  await expect(page.getByRole("heading", { name: "My Drive" })).toBeVisible();
  // Items count chip (we seed 3 folders + 5 files = 8 items).
  await expect(page.getByText(/^8 items$/)).toBeVisible();
});

test("sign-out returns to the sign-in card", async ({ page }) => {
  await signInDemo(page);
  // No avatar dropdown in v0 — flip the demo's persisted state directly
  // and reload to make AuthContext re-bootstrap.
  await page.evaluate(() => {
    const key = "cd-demo-state-v1";
    const raw = window.localStorage.getItem(key);
    if (raw) {
      const s = JSON.parse(raw);
      s.signedIn = false;
      window.localStorage.setItem(key, JSON.stringify(s));
    }
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Doc-Hub" })).toBeVisible({
    timeout: 10_000,
  });
});
