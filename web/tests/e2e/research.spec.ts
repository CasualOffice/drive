import { expect, test } from "@playwright/test";
import { resetDemoState, signInDemo } from "./_helpers.ts";

test.beforeEach(async ({ page }) => {
  await resetDemoState(page);
  await signInDemo(page);
});

test("agentic research answers a question with sources and a search trace", async ({
  page,
}) => {
  const search = page.getByPlaceholder("Search documents and folders");
  await search.fill("what is the data retention policy?");

  // The research surface offers a deliberate trigger — distinct from the
  // instant AskPanel, since the agent loop is multi-step.
  const panel = page.getByTestId("research-panel");
  await expect(panel).toBeVisible({ timeout: 3_000 });
  const run = page.getByTestId("research-run");
  await expect(run).toBeVisible();
  await run.click();

  // The composed answer draws from the brief's retention sentence.
  await expect(page.getByTestId("research-answer")).toContainText(/retention/i, {
    timeout: 5_000,
  });
  // Sources are surfaced as clickable chips.
  await expect(panel.getByText("Sources")).toBeVisible();
  // The agent's search trace — its differentiator from a single-shot ask —
  // is shown, echoing the query it ran.
  const trace = page.getByTestId("research-trace");
  await expect(trace).toBeVisible();
  await expect(trace).toContainText(/retention/i);
});

test("research trigger only appears for question-like queries", async ({
  page,
}) => {
  const search = page.getByPlaceholder("Search documents and folders");
  // A bare keyword search is not a question — no research surface.
  await search.fill("planning");
  await expect(page.getByRole("heading", { name: "Search results" })).toBeVisible({
    timeout: 3_000,
  });
  await expect(page.getByTestId("research-panel")).toHaveCount(0);

  // Rephrased as a question, the surface appears.
  await search.fill("what does the architecture overview cover?");
  await expect(page.getByTestId("research-panel")).toBeVisible({ timeout: 3_000 });
});
