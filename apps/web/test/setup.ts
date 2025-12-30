/**
 * Test Setup
 *
 * This file runs before each test file. It configures:
 * - MSW server for mocking API requests
 * - Testing Library matchers (toBeInTheDocument, etc.)
 * - Automatic DOM cleanup after each test
 */

import { beforeAll, afterEach, afterAll } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { server } from "./mocks/server";

// Start the mock server before any tests run
beforeAll(() => {
  server.listen({
    // Warn (don't error) on unhandled requests during development
    onUnhandledRequest: "warn",
  });
});

// Reset handlers and clean up DOM after each test
afterEach(() => {
  server.resetHandlers();
  cleanup();
});

// Shut down the server when all tests are done
afterAll(() => {
  server.close();
});
