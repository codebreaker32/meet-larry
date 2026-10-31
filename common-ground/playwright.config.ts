import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

// End-to-end tests run against a dev server. One is usually already running on :3000
// (only one `next dev` can run per project), so it is reused; otherwise Playwright starts one.
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

// Use a Chromium already on this machine when there is one (PW_CHROME, or the usual cache
// path for this Playwright version); elsewhere `npx playwright install chromium` provides it.
const localChrome = path.join(homedir(), ".cache/ms-playwright/chromium-1208/chrome-linux64/chrome");
const executablePath = process.env.PW_CHROME || (existsSync(localChrome) ? localChrome : undefined);

/**
 * The test environment for the app under test (final-build-plan section 2, rule 5):
 *  - NEXT_PUBLIC_E2E=1 swaps the client phone sign-in for a fake that returns `e2e:<uid>` tokens.
 *  - E2E=1 lets the server accept those tokens (never when NODE_ENV is production).
 *  - LARRY_DB=memory: no test touches real Firestore.
 * They reach the dev server only when Playwright starts it. A dev server already running on :3000
 * is reused as is, so start it with the same variables when a spec needs them, e.g.
 *   NEXT_PUBLIC_E2E=1 E2E=1 LARRY_DB=memory npx next dev -p 3000
 * To run beside someone else's server, pick another port and a private build folder, e.g.
 *   E2E_BASE_URL=http://localhost:3200 NEXT_DIST_DIR=.next/e2e-mine npx playwright test --output=<own dir>
 * (the one demo account is recognised only on the server from DEMO_PHONE; there is no demo dwell knob).
 */
export const E2E_ENV = {
  NEXT_PUBLIC_E2E: "1",
  E2E: "1",
  LARRY_DB: "memory",
} as const;
// Specs and fixtures read the same values.
for (const [k, v] of Object.entries(E2E_ENV)) process.env[k] ??= v;

export default defineConfig({
  testDir: "./e2e",
  // Several agents run specs at once: E2E_OUTPUT_DIR (or --output) keeps each run's results apart.
  ...(process.env.E2E_OUTPUT_DIR ? { outputDir: process.env.E2E_OUTPUT_DIR } : {}),
  // Makes this run's access codes (see e2e/global-setup.ts).
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // A dev server compiles routes on first hit; a few workers keep it from timing out.
  workers: process.env.CI ? 2 : 3,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    contextOptions: { reducedMotion: "reduce" },
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 900 } } },
    {
      name: "mobile",
      use: { browserName: "chromium", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    command: `npx next dev -p ${new URL(baseURL).port || "3000"}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
    env: { ...E2E_ENV },
  },
});
