import { test, expect, type Page } from "@playwright/test";

/**
 * E2E Tests requiring authentication.
 *
 * These tests run with pre-authenticated browser state loaded from
 * test/e2e/.auth/user.json. The setup project must run first.
 *
 * DATA ISOLATION:
 * - Uses a dedicated test user account (not your manual testing account)
 * - Test data uses unique timestamps to avoid conflicts
 * - Tests clean up invitations they create
 * - Orgs are left in place (user can only have one org, so org tests
 *   only run if user has no org)
 *
 * Test scenarios from docs/phase-9-tutorial.md:
 * 1. Organization creation (if user has no org)
 * 2. Member invitation (if user has org and is admin)
 */

// Test org data - unique per test run
const testOrg = {
  name: `E2E Test Org ${Date.now()}`,
  type: "Law Firm",
  size: "Solo Practitioner",
  jurisdiction: "CA",
  practiceArea: "General Practice",
};

// Unique invitee email per test run
const inviteeEmail = `invitee-${Date.now()}@e2e.test`;

test.describe("Organization Creation Flow", () => {
  test("user can access dashboard when authenticated", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL("/dashboard");
    await expect(
      page.getByRole("heading", { name: /dashboard/i })
    ).toBeVisible();
  });

  test("user can navigate to org creation page", async ({ page }) => {
    await page.goto("/org/create");

    // If user already has an org, they'll be redirected to dashboard
    // Otherwise, they'll see the org creation form
    const url = page.url();
    if (url.includes("/org/create")) {
      await expect(
        page.getByRole("heading", { name: /organization type/i })
      ).toBeVisible();
    } else {
      // User already has an org - skip remaining org creation tests
      test.skip(true, "User already has an organization");
    }
  });

  test("user can complete org creation wizard", async ({ page }) => {
    await page.goto("/org/create");

    // Skip if user already has an org
    if (!page.url().includes("/org/create")) {
      test.skip(true, "User already has an organization");
      return;
    }

    // Step 1: Org type
    await page.getByRole("button", { name: testOrg.type }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    // Step 2: Basic info
    await expect(
      page.getByRole("heading", { name: /basic information/i })
    ).toBeVisible();
    await page.getByLabel(/organization name/i).fill(testOrg.name);
    await page.getByRole("button", { name: testOrg.size }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    // Step 3: Jurisdictions
    await expect(
      page.getByRole("heading", { name: /jurisdictions/i })
    ).toBeVisible();
    // Click the label text instead of checkbox (CSS covers the input)
    await page.getByText(testOrg.jurisdiction, { exact: true }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    // Step 4: Practice areas
    await expect(
      page.getByRole("heading", { name: /practice areas/i })
    ).toBeVisible();
    await page.getByText(testOrg.practiceArea, { exact: true }).click();
    await page.getByRole("button", { name: /create organization/i }).click();

    // Should redirect to dashboard with org
    await expect(page).toHaveURL("/dashboard");
    await expect(page.getByText(testOrg.name)).toBeVisible();
  });
});

test.describe("Member Invitation Flow", () => {
  test("admin can access members page", async ({ page }) => {
    await page.goto("/org/members");

    // If not admin or no org, will redirect to dashboard
    if (!page.url().includes("/org/members")) {
      test.skip(true, "User is not admin or has no organization");
      return;
    }

    await expect(
      page.getByRole("heading", { name: /current members/i })
    ).toBeVisible();
  });

  test("admin can open invite modal", async ({ page }) => {
    await page.goto("/org/members");

    if (!page.url().includes("/org/members")) {
      test.skip(true, "User is not admin or has no organization");
      return;
    }

    await page.getByRole("button", { name: /invite member/i }).click();
    await expect(
      page.getByRole("heading", { name: /invite a team member/i })
    ).toBeVisible();
  });

  test("admin can send invitation and revoke it", async ({ page }) => {
    await page.goto("/org/members");

    if (!page.url().includes("/org/members")) {
      test.skip(true, "User is not admin or has no organization");
      return;
    }

    // Open invite modal
    await page.getByRole("button", { name: /invite member/i }).click();

    // Fill form
    await page.getByLabel(/email address/i).fill(inviteeEmail);
    await page.getByLabel(/role/i).selectOption("member");

    // Submit
    await page.getByRole("button", { name: /send invitation/i }).click();

    // Verify success
    await expect(page.getByText(/invitation sent/i)).toBeVisible();

    // Verify invitation appears in list
    await expect(page.getByText(inviteeEmail)).toBeVisible();

    // CLEANUP: Revoke the invitation we just created
    // Find the row with our invitee email and click Revoke
    const invitationRow = page.locator("tr", { hasText: inviteeEmail });

    // Handle confirmation dialog
    page.on("dialog", (dialog) => dialog.accept());

    await invitationRow.getByRole("button", { name: /revoke/i }).click();

    // Verify invitation is removed
    await expect(page.getByText(inviteeEmail)).not.toBeVisible();
  });
});

test.describe("Organization Settings", () => {
  test("admin can access org settings", async ({ page }) => {
    await page.goto("/org/settings");

    if (!page.url().includes("/org/settings")) {
      test.skip(true, "User is not admin or has no organization");
      return;
    }

    await expect(
      page.getByRole("heading", { name: /settings/i })
    ).toBeVisible();
  });
});
