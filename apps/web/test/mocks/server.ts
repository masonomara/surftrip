/**
 * MSW Server
 *
 * Creates a mock server for Node.js (used in vitest).
 * The handlers define default responses for API endpoints.
 * Individual tests can override handlers using server.use().
 */

import { setupServer } from "msw/node";
import { handlers } from "./handlers";

export const server = setupServer(...handlers);
