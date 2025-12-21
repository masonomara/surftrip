/**
 * Shared Domain Types
 *
 * Central location for all domain types used across the application.
 * Import from here instead of defining types inline.
 */

// ============================================================================
// Enums & Unions
// ============================================================================

export type OrgRole = "admin" | "member";
export type ChannelType = "teams" | "slack" | "mcp" | "chatgpt";
export type AuditResult = "success" | "error";

// ============================================================================
// Domain Entities
// ============================================================================

export interface Organization {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface OrgSettings {
  jurisdiction: string | null;
  practiceType: string | null;
  firmSize: string | null;
}

export interface OrgMembership {
  id: string;
  userId: string;
  orgId: string;
  role: OrgRole;
  isOwner: boolean;
  createdAt: number;
}

export interface Invitation {
  id: string;
  email: string;
  orgId: string;
  role: OrgRole;
  invitedBy: string;
  createdAt: number;
  expiresAt: number;
  acceptedAt: number | null;
}

export interface ChannelLink {
  channelType: ChannelType;
  channelUserId: string;
  userId: string;
}

export interface AuditEntry {
  id: string;
  userId: string;
  action: string;
  objectType: string;
  params: Record<string, unknown>;
  result: AuditResult;
  errorMessage?: string;
  createdAt: string;
}

// ============================================================================
// Database Row Types (snake_case, matches D1 schema)
// ============================================================================

export interface OrgRow {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
}

export interface OrgMemberRow {
  id: string;
  user_id: string;
  org_id: string;
  role: OrgRole;
  is_owner: number; // SQLite boolean
  created_at: number;
}

export interface InvitationRow {
  id: string;
  email: string;
  org_id: string;
  role: OrgRole;
  invited_by: string;
  created_at: number;
  expires_at: number;
  accepted_at: number | null;
}

export interface ChannelLinkRow {
  id: string;
  channel_type: ChannelType;
  channel_user_id: string;
  user_id: string;
  created_at: number;
}

export interface KBChunkRow {
  id: string;
  content: string;
  source: string;
  category: string | null;
  jurisdiction: string | null;
  practice_type: string | null;
  firm_size: string | null;
}

export interface OrgContextChunkRow {
  id: string;
  org_id: string;
  file_id: string;
  content: string;
  source: string;
  chunk_index: number;
  uploaded_by: string | null;
}

// ============================================================================
// Error Classes
// ============================================================================

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  constructor(resource: string, id?: string) {
    super(id ? `${resource} not found: ${id}` : `${resource} not found`);
    this.name = "NotFoundError";
  }
}

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

// ============================================================================
// Row to Entity Converters
// ============================================================================

export function orgMemberRowToEntity(row: OrgMemberRow): OrgMembership {
  return {
    id: row.id,
    userId: row.user_id,
    orgId: row.org_id,
    role: row.role,
    isOwner: row.is_owner === 1,
    createdAt: row.created_at,
  };
}

export function invitationRowToEntity(row: InvitationRow): Invitation {
  return {
    id: row.id,
    email: row.email,
    orgId: row.org_id,
    role: row.role,
    invitedBy: row.invited_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
  };
}
