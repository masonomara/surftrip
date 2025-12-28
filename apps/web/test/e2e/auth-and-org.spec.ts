import { test, expect, type Page } from "@playwright/test";

/**
 * E2E Tests for Phase 9: Authentication and Organization Creation
 *
 * Test scenarios from docs/phase-9-tutorial.md lines 709-728:
 * 1. User can sign up and create an organization
 * 2. User can invite a team member
 *
 * Prerequisites:
 * - Web app running on localhost:5173
 * - API worker running on localhost:8787
 * - Test emails use pattern: test-{timestamp}@e2e.docket.local
 */

// Generate unique test data for each run
const timestamp = Date.now();
const testUser = {
  email: `test-${timestamp}@e2e.docket.local`,
  name: "E2E Test User",
  password: "TestPassword123!",
};
const testOrg = {
  name: `Test Firm ${timestamp}`,
  type: "Law Firm",
  size: "Solo Practitioner",
  jurisdiction: "CA",
  practiceArea: "General Practice",
};
const inviteeEmail = `invitee-${timestamp}@e2e.docket.local`;

test.describe("Authentication Flow", () => {
  test("user can navigate to signup page", async ({ page }) => {
    await page.goto("/auth");
    await expect(page).toHaveURL("/auth");
    await expect(
      page.getByRole("heading", { name: /work with docket/i })
    ).toBeVisible();
  });

  test("user can enter email and proceed to signup", async ({ page }) => {
    await page.goto("/auth");

    // Enter email
    const emailInput = page.getByLabel(/email/i);
    await emailInput.fill(testUser.email);

    // Click the submit Continue button (not "Continue with Google")
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    // Should show signup form (new user)
    await expect(
      page.getByRole("heading", { name: /create your account/i })
    ).toBeVisible();
  });

  test("user can complete signup form", async ({ page }) => {
    await page.goto("/auth");

    // Step 1: Enter email
    await page.getByLabel(/email/i).fill(testUser.email);
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    // Step 2: Fill signup form
    await expect(
      page.getByRole("heading", { name: /create your account/i })
    ).toBeVisible();

    await page.getByLabel(/name/i).fill(testUser.name);
    await page.getByLabel(/password/i).fill(testUser.password);

    // Submit signup
    await page.getByRole("button", { name: /sign up/i }).click();

    // Should show email verification screen
    await expect(
      page.getByRole("heading", { name: /check your email/i })
    ).toBeVisible();
  });
});

test.describe("Organization Creation Flow", () => {
  // This test requires a verified user session
  // In real E2E testing, you'd either:
  // 1. Use a pre-seeded test account
  // 2. Mock the email verification
  // 3. Use storage state from a manual login

  test.skip("user can access org creation page when logged in", async ({
    page,
  }) => {
    // TODO: Requires authenticated session
    // This would use storageState from a pre-authenticated user
    await page.goto("/org/create");
    await expect(
      page.getByRole("heading", { name: /organization type/i })
    ).toBeVisible();
  });

  test.skip("user can complete step 1: select organization type", async ({
    page,
  }) => {
    await page.goto("/org/create");

    // Select Law Firm
    await page.getByRole("button", { name: testOrg.type }).click();

    // Verify selection is highlighted
    await expect(page.getByRole("button", { name: testOrg.type })).toHaveClass(
      /selected/
    );

    // Continue button should be enabled
    await expect(
      page.getByRole("button", { name: "Continue", exact: true })
    ).toBeEnabled();
  });

  test.skip("user can complete step 2: enter basic information", async ({
    page,
  }) => {
    await page.goto("/org/create");

    // Complete step 1
    await page.getByRole("button", { name: testOrg.type }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    // Step 2: Basic Info
    await expect(
      page.getByRole("heading", { name: /basic information/i })
    ).toBeVisible();

    // Enter organization name
    await page.getByLabel(/organization name/i).fill(testOrg.name);

    // Select firm size
    await page.getByRole("button", { name: testOrg.size }).click();

    // Continue
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    // Should move to step 3
    await expect(
      page.getByRole("heading", { name: /jurisdictions/i })
    ).toBeVisible();
  });

  test.skip("user can complete step 3: select jurisdictions", async ({
    page,
  }) => {
    await page.goto("/org/create");

    // Complete steps 1-2
    await page.getByRole("button", { name: testOrg.type }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByLabel(/organization name/i).fill(testOrg.name);
    await page.getByRole("button", { name: testOrg.size }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    // Step 3: Jurisdictions
    await expect(
      page.getByRole("heading", { name: /jurisdictions/i })
    ).toBeVisible();

    // Select California
    await page.getByLabel(testOrg.jurisdiction).check();

    // Continue
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    // Should move to step 4
    await expect(
      page.getByRole("heading", { name: /practice areas/i })
    ).toBeVisible();
  });

  test.skip("user can complete step 4: select practice areas and create org", async ({
    page,
  }) => {
    await page.goto("/org/create");

    // Complete steps 1-3
    await page.getByRole("button", { name: testOrg.type }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByLabel(/organization name/i).fill(testOrg.name);
    await page.getByRole("button", { name: testOrg.size }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByLabel(testOrg.jurisdiction).check();
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    // Step 4: Practice Areas
    await expect(
      page.getByRole("heading", { name: /practice areas/i })
    ).toBeVisible();

    // Select General Practice
    await page.getByLabel(testOrg.practiceArea).check();

    // Create Organization
    await page.getByRole("button", { name: /create organization/i }).click();

    // Should redirect to dashboard with org
    await expect(page).toHaveURL("/dashboard");
    await expect(page.getByText(testOrg.name)).toBeVisible();
  });
});

test.describe("Member Invitation Flow", () => {
  test.skip("admin can access members page", async ({ page }) => {
    // TODO: Requires authenticated admin session
    await page.goto("/org/members");
    await expect(
      page.getByRole("heading", { name: /current members/i })
    ).toBeVisible();
  });

  test.skip("admin can open invite modal", async ({ page }) => {
    await page.goto("/org/members");

    // Click invite button
    await page.getByRole("button", { name: /invite member/i }).click();

    // Modal should appear
    await expect(
      page.getByRole("heading", { name: /invite a team member/i })
    ).toBeVisible();
  });

  test.skip("admin can fill and submit invitation form", async ({ page }) => {
    await page.goto("/org/members");

    // Open invite modal
    await page.getByRole("button", { name: /invite member/i }).click();

    // Fill invitation form
    await page.getByLabel(/email address/i).fill(inviteeEmail);

    // Select role (member is default)
    await page.getByLabel(/role/i).selectOption("member");

    // Submit invitation
    await page.getByRole("button", { name: /send invitation/i }).click();

    // Should show success and pending invitation
    await expect(page.getByText(/invitation sent/i)).toBeVisible();
    await expect(page.getByText(inviteeEmail)).toBeVisible();
  });

  test.skip("pending invitation appears in list", async ({ page }) => {
    await page.goto("/org/members");

    // Check pending invitations section
    await expect(
      page.getByRole("heading", { name: /pending invitations/i })
    ).toBeVisible();

    // Verify the invitation we sent is listed
    await expect(page.getByText(inviteeEmail)).toBeVisible();
  });
});

/**
 * Full integration test combining signup + org creation
 * This test demonstrates the complete happy path but requires
 * email verification to be disabled or mocked in test environment.
 */
test.describe("Full User Journey", () => {
  test.skip("complete flow: signup -> create org -> invite member", async ({
    page,
  }) => {
    // 1. Navigate to signup
    await page.goto("/auth");

    // 2. Enter email
    await page.getByLabel(/email/i).fill(testUser.email);
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    // 3. Fill signup form
    await page.getByLabel(/name/i).fill(testUser.name);
    await page.getByLabel(/password/i).fill(testUser.password);
    await page.getByRole("button", { name: /sign up/i }).click();

    // Note: Email verification would happen here
    // In a real test, you'd mock this or use a test email service

    // 4. After verification, user lands on dashboard
    await page.goto("/dashboard");

    // 5. Click create organization
    await page.getByRole("button", { name: /create organization/i }).click();
    await expect(page).toHaveURL("/org/create");

    // 6. Step 1: Org type
    await page.getByRole("button", { name: testOrg.type }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    // 7. Step 2: Basic info
    await page.getByLabel(/organization name/i).fill(testOrg.name);
    await page.getByRole("button", { name: testOrg.size }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    // 8. Step 3: Jurisdictions
    await page.getByLabel(testOrg.jurisdiction).check();
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    // 9. Step 4: Practice areas
    await page.getByLabel(testOrg.practiceArea).check();
    await page.getByRole("button", { name: /create organization/i }).click();

    // 10. Should redirect to dashboard with org
    await expect(page).toHaveURL("/dashboard");
    await expect(page.getByText(testOrg.name)).toBeVisible();

    // 11. Navigate to members
    await page.goto("/org/members");

    // 12. Open invite modal
    await page.getByRole("button", { name: /invite member/i }).click();

    // 13. Fill invitation form
    await page.getByLabel(/email address/i).fill(inviteeEmail);
    await page.getByRole("button", { name: /send invitation/i }).click();

    // 14. Should see pending invitation
    await expect(page.getByText(/invitation sent/i)).toBeVisible();
    await expect(page.getByText(inviteeEmail)).toBeVisible();
  });
});

/**
 * Page object helpers for more maintainable tests.
 * These could be extracted to a separate file for larger test suites.
 */
async function signUp(
  page: Page,
  email: string,
  name: string,
  password: string
) {
  await page.goto("/auth");
  await page.getByLabel(/email/i).fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel(/name/i).fill(name);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign up/i }).click();
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/auth");
  await page.getByLabel(/email/i).fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /log in/i }).click();
}

async function createOrganization(
  page: Page,
  orgData: {
    type: string;
    name: string;
    size: string;
    jurisdiction: string;
    practiceArea: string;
  }
) {
  await page.goto("/org/create");

  // Step 1: Type
  await page.getByRole("button", { name: orgData.type }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  // Step 2: Basic info
  await page.getByLabel(/organization name/i).fill(orgData.name);
  await page.getByRole("button", { name: orgData.size }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  // Step 3: Jurisdictions
  await page.getByLabel(orgData.jurisdiction).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  // Step 4: Practice areas
  await page.getByLabel(orgData.practiceArea).check();
  await page.getByRole("button", { name: /create organization/i }).click();
}

async function inviteMember(page: Page, email: string, role = "member") {
  await page.goto("/org/members");
  await page.getByRole("button", { name: /invite member/i }).click();
  await page.getByLabel(/email address/i).fill(email);
  await page.getByLabel(/role/i).selectOption(role);
  await page.getByRole("button", { name: /send invitation/i }).click();
}
