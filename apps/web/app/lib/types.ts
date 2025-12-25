/**
 * Response from the /api/auth/get-session endpoint.
 * Contains both the session details and the authenticated user.
 */
export interface SessionResponse {
  session: {
    id: string;
    userId: string;
    expiresAt: string;
  };
  user: {
    id: string;
    email: string;
    name: string;
  };
}

/**
 * A user's membership in an organization.
 * Returned from /api/user/org endpoint.
 */
export interface OrgMembership {
  org: {
    id: string;
    name: string;
  };
  role: "admin" | "member";
  isOwner: boolean;
}
