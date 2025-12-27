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
    jurisdictions?: string[];
    practiceTypes?: string[];
    firmSize?: string;
  };
  role: "admin" | "member";
  isOwner: boolean;
}

/**
 * A member of an organization with user details.
 * Returned from /api/org/members endpoint.
 */
export interface OrgMember {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: "admin" | "member";
  isOwner: boolean;
  createdAt: number;
}

/**
 * A pending invitation to join an organization.
 * Returned from /api/org/invitations endpoint.
 */
export interface PendingInvitation {
  id: string;
  email: string;
  role: "admin" | "member";
  invitedBy: string;
  inviterName: string;
  createdAt: number;
  expiresAt: number;
}

/**
 * Invitation details returned from /api/invitations/:id
 * Used on signup/invite acceptance pages.
 */
export interface InvitationDetails {
  id: string;
  email: string;
  orgName: string;
  role: "admin" | "member";
  inviterName: string;
  isExpired: boolean;
  isAccepted: boolean;
}

/**
 * An organization context document.
 * Returned from /api/org/documents endpoint.
 */
export interface OrgContextDocument {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  uploadedAt: number;
  chunkCount: number;
}
