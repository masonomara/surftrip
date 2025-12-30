/**
 * MSW Request Handlers
 *
 * Default mock responses for API endpoints used in tests.
 * Tests can override these using server.use() for specific scenarios.
 */

import { http, HttpResponse } from "msw";

// Must match VITE_API_URL in .env (used during tests)
const API_BASE = "http://localhost:8787";

// ============================================================================
// Mock Data
// ============================================================================

export const mockUser = {
  id: "user-1",
  email: "test@example.com",
  name: "Test User",
  emailVerified: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

export const mockSession = {
  session: {
    id: "sess-1",
    userId: "user-1",
    expiresAt: new Date(Date.now() + 86400000).toISOString(), // 24 hours from now
  },
  user: mockUser,
};

export const mockOrg = {
  org: {
    id: "org-1",
    name: "Test Firm",
    type: "law_firm",
  },
  role: "admin" as const,
  isOwner: true,
};

export const mockInvitation = {
  id: "inv-1",
  email: "invite@example.com",
  orgName: "Test Firm",
  role: "member" as const,
  inviterName: "Admin User",
  isExpired: false,
  isAccepted: false,
};

// ============================================================================
// Default Handlers (authenticated user)
// ============================================================================

export const handlers = [
  // Auth endpoints
  http.get(`${API_BASE}/api/auth/get-session`, () => {
    return HttpResponse.json(mockSession);
  }),

  http.post(`${API_BASE}/api/auth/sign-in/email`, () => {
    return HttpResponse.json(
      { user: mockUser },
      { headers: { "Set-Cookie": "session=mock-session; Path=/" } }
    );
  }),

  http.post(`${API_BASE}/api/auth/sign-up/email`, () => {
    return HttpResponse.json({ user: mockUser });
  }),

  http.post(`${API_BASE}/api/auth/sign-out`, () => {
    return HttpResponse.json({ success: true });
  }),

  http.post(`${API_BASE}/api/auth/send-verification-email`, () => {
    return HttpResponse.json({ success: true });
  }),

  // User endpoints
  http.post(`${API_BASE}/api/check-email`, () => {
    return HttpResponse.json({ exists: true, hasPassword: true });
  }),

  http.get(`${API_BASE}/api/user/org`, () => {
    return HttpResponse.json(mockOrg);
  }),

  // Invitation endpoints
  http.get(`${API_BASE}/api/invitations/:id`, ({ params }) => {
    return HttpResponse.json({
      ...mockInvitation,
      id: params.id,
    });
  }),
];

// ============================================================================
// Unauthenticated Handlers
// Use: server.use(...unauthenticatedHandlers)
// ============================================================================

export const unauthenticatedHandlers = [
  http.get(`${API_BASE}/api/auth/get-session`, () => {
    return HttpResponse.json(null);
  }),

  http.get(`${API_BASE}/api/user/org`, () => {
    return new HttpResponse(null, { status: 401 });
  }),
];
