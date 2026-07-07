import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config. Drives the demo-mode SPA at vite preview — no Drive
 * backend involved. Demo mode handles auth + state in localStorage, which
 * gives us deterministic, fast smoke tests that run in CI without spinning
 * up Rust.
 *
 * Local: `VITE_DEMO_MODE=1 pnpm build && pnpm test:e2e`
 * CI:    `.github/workflows/ci.yml` job `e2e` does the same.
 */
const PORT = 4173;
const HOST = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.spec\.ts$/,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: HOST,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
  webServer: {
    // `--host 127.0.0.1` makes Vite bind on IPv4 explicitly so the
    // baseURL probe (which uses the same address) succeeds.
    command: `pnpm preview --port ${PORT} --strictPort --host 127.0.0.1`,
    url: HOST,
    timeout: 30_000,
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
    stderr: "pipe",
  },
});
