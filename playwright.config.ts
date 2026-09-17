import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Every test builds a fully isolated workspace (own temp dir, database,
  // port, and HOME), so tests can be scheduled freely across workers in CI
  // to cut the wall time.
  fullyParallel: true,
  workers: process.env.CI ? 4 : 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "line",
  use: {
    browserName: "chromium",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    viewport: { width: 390, height: 844 }
  },
  outputDir: "test-results/playwright"
});
