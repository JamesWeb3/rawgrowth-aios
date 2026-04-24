import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright runs the §9.8 smoke suite against a live v3 VPS. The
 * target URL comes from E2E_BASE_URL (staging or dogfood). For D14
 * final demo we run twice — once post-provision on a fresh droplet,
 * once on the Rawgrowth dogfood VPS.
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
