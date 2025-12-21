/**
 * Shared Domain Types
 */

export type OrgRole = "admin" | "member";
export type ChannelType = "teams" | "slack" | "mcp" | "chatgpt";

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
  result: "success" | "error";
  errorMessage?: string;
  createdAt: string;
}

export interface OrgMemberRow {
  id: string;
  user_id: string;
  org_id: string;
  role: OrgRole;
  is_owner: number;
  created_at: number;
}

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
