import { defineConfig, devices } from "@playwright/test";

/**
 * The smoke suite runs against a real stack, never a mock.
 *
 * Everything this suite can catch is something no unit test can: a wrong
 * VITE_API_BASE_URL, a cookie the browser refuses because APP_BASE_URL says
 * http while the page is served over https, an nginx that does not proxy /api,
 * a migration that did not run. Each of those has actually happened here, and
 * each one passes every test in both workspaces.
 *
 * BASE_URL points at whatever is serving the web app: the compose stack on
 * :3000 by default, or the Vite dev server on :5173 while developing.
 */
const baseURL = process.env.BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  // One path through the product, in order. Running it in parallel would have
  // two browsers checking the same asset in and out of the same demo register.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    // Kept only for a failure: a passing run should leave nothing behind.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
