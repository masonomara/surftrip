import { test as setup, expect } from "@playwright/test";

const authFile = "test/e2e/.auth/user.json";

/**
 * Authentication setup for E2E tests.
 *
 * This logs in with a test account and saves the browser state.
 * Handles cases where user is already logged in, needs to log in, or needs to sign up.
 */

const TEST_USER = {
  email: process.env.TEST_USER_EMAIL || "test@e2e.docket.local",
  password: process.env.TEST_USER_PASSWORD || "TestPassword123!",
  name: process.env.TEST_USER_NAME || "E2E Test User",
};

setup("authenticate", async ({ page }) => {
  setup.skip(
    !process.env.TEST_USER_EMAIL && !process.env.E2E_AUTH_ENABLED,
    "Skipped: Set TEST_USER_EMAIL or E2E_AUTH_ENABLED to run authenticated tests"
  );

  // First check if we're already logged in by going to dashboard
  await page.goto("/dashboard");
  await page.waitForTimeout(2000);

  // If we're on dashboard, we're already logged in
  if (page.url().includes("/dashboard")) {
    console.log(`Already logged in, saving state`);
    await page.context().storageState({ path: authFile });
    return;
  }

  // Not logged in, go to auth page
  await page.goto("/auth");
  await page.waitForTimeout(1000);

  // Enter email
  await page.getByLabel(/email/i).fill(TEST_USER.email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  // Wait for form transition
  await page.waitForTimeout(1500);

  // Check which form appeared
  const loginHeading = page.getByRole("heading", { name: /welcome back/i });
  const signupHeading = page.getByRole("heading", {
    name: /create your account/i,
  });
  const oauthHeading = page.getByText(/uses Google sign-in/i);

  const isLogin = await loginHeading.isVisible().catch(() => false);
  const isSignup = await signupHeading.isVisible().catch(() => false);
  const isOAuth = await oauthHeading.isVisible().catch(() => false);

  if (isOAuth) {
    throw new Error(
      `Account ${TEST_USER.email} uses Google sign-in. ` +
        `Create a password-based test account instead.`
    );
  }

  if (isSignup) {
    // Account doesn't exist - create it
    console.log(`Creating new test account: ${TEST_USER.email}`);

    await page.getByLabel(/name/i).fill(TEST_USER.name);
    await page.getByLabel(/password/i).fill(TEST_USER.password);
    await page.getByRole("button", { name: /sign up/i }).click();

    // Check if we need email verification
    await page.waitForTimeout(2000);

    if (page.url().includes("/dashboard")) {
      // No verification needed, we're in
      await page.context().storageState({ path: authFile });
      return;
    }

    const checkEmailHeading = page.getByRole("heading", {
      name: /check your email/i,
    });
    const needsVerification = await checkEmailHeading
      .isVisible()
      .catch(() => false);

    if (needsVerification) {
      throw new Error(
        `Account created for ${TEST_USER.email} but requires email verification.\n` +
          `Please verify the email and run tests again.`
      );
    }
  } else if (isLogin) {
    // Account exists - log in
    console.log(`Logging in as: ${TEST_USER.email}`);

    await page.getByLabel(/password/i).fill(TEST_USER.password);
    await page.getByRole("button", { name: /log in/i }).click();

    // Wait for redirect
    await expect(page).toHaveURL("/dashboard", { timeout: 10000 });
  } else {
    // Take a screenshot to debug
    await page.screenshot({ path: "test-results/auth-debug.png" });
    throw new Error(
      `Unexpected auth state for ${TEST_USER.email}. ` +
        `Screenshot saved to test-results/auth-debug.png`
    );
  }

  // Save the authenticated state
  await page.context().storageState({ path: authFile });
  console.log(`Auth state saved to ${authFile}`);
});
