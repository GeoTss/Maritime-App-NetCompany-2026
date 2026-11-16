import { defineConfig, devices } from "@playwright/test";

/**
 * The demo story. No webServer block: the stack is brought up by `npm run demo:reset`
 * (web on :5173, api on :4000). Replay answers in seconds; a live model-backed answer takes ~45 s.
 */
export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results/",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // One serial story that includes model-backed steps.
  timeout: 300_000,
  expect: { timeout: 60_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    screenshot: "on",
    trace: "retain-on-failure",
    reducedMotion: "reduce",
    actionTimeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
