import { defineConfig, devices } from "@playwright/test";
import * as fs from "fs";

/**
 * Playwright E2E test configuration for Docket web app.
 *
 * Run tests:
 *   npm run test:e2e        - Run all E2E tests
 *   npm run test:e2e:ui     - Run with UI mode
 *
 * Authentication:
 *   Tests requiring auth use storage state from .auth/user.json.
 *   Set TEST_USER_EMAIL and TEST_USER_PASSWORD, then run:
 *     npx playwright test --project=setup
 *
 * Requires:
 *   - Web app running: npm run dev (port 5173)
 *   - API worker running: cd ../api && npm run dev (port 8787)
 */

const authFile = "test/e2e/.auth/user.json";
const hasAuthState = fs.existsSync(authFile);

export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "html",

  use: {
    baseURL: process.env.BASE_URL || "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    // Setup project: authenticates and saves state
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },

    // Unauthenticated tests (signup, login forms)
    {
      name: "unauthenticated",
      testMatch: /auth-and-org\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },

    // Authenticated tests - only run if auth state exists
    ...(hasAuthState || process.env.E2E_AUTH_ENABLED
      ? [
          {
            name: "authenticated",
            testMatch: /authenticated\.spec\.ts/,
            dependencies: ["setup"],
            use: {
              ...devices["Desktop Chrome"],
              storageState: authFile,
            },
          },
        ]
      : []),
  ],

  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: true, // Always reuse if running; CI should pre-start
    timeout: 60 * 1000,
  },
});
