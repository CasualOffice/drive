import { expect, type Page } from "@playwright/test";

/** Sign in via the pre-filled demo credentials and wait for the shell.
 * Asserts that the demo callout is on the sign-in card before submitting
 * so a misconfigured (non-demo) build fails loudly rather than mysteriously. */
export async function signInDemo(page: Page) {
  await page.goto("/");
  // Sign-in card title.
  await expect(page.getByRole("heading", { name: "Casual Drive" })).toBeVisible({
    timeout: 10_000,
  });
  // Pre-filled credentials are the demo-mode signal — empty inputs mean we
  // accidentally ran against a non-demo build.
  await expect(page.getByPlaceholder("Username")).toHaveValue("demo");
  await page.getByRole("button", { name: /sign in/i }).click();
  // Shell renders — the demo banner appears at the top.
  await expect(page.getByRole("status").first()).toContainText(/Demo/, {
    timeout: 10_000,
  });
}

/** Make sure each test starts from a known demo state.
 *
 * The demo module hydrates its in-memory state from localStorage at first
 * import — so we need to wipe localStorage BEFORE the page loads, not
 * after. addInitScript runs in every fresh document context.
 */
export async function resetDemoState(page: Page) {
  // Cheap empty document so we have a window to attach storage events to.
  await page.goto("about:blank");
  await page.evaluate(() => {
    try {
      window.localStorage.clear();
    } catch {
      /* ignored */
    }
  });
  await page.addInitScript(() => {
    try {
      window.localStorage.clear();
    } catch {
      /* ignored */
    }
  });
}
