export type ChannelType = "teams" | "slack" | "mcp" | "chatgpt" | "web";
export type ConversationScope = "personal" | "groupChat" | "teams" | "dm" | "channel" | "api";
export type UserRole = "admin" | "member";
export type FirmSize = "solo" | "small" | "mid" | "large";

export interface ChannelMessage {
  channel: ChannelType;
  orgId: string;
  userId: string;
  userRole: UserRole;
  conversationId: string;
  conversationScope: ConversationScope;
  message: string;
  jurisdiction: string | null;
  practiceType: string | null;
  firmSize: FirmSize | null;
  metadata?: {
    threadId?: string;
    teamsChannelId?: string;
    slackChannelId?: string;
  };
}

export interface DOResponse {
  success: boolean;
  message?: string;
  error?: string;
  data?: Record<string, unknown>;
}

export interface ProcessMessageResponse extends DOResponse {
  conversationId: string;
  responseText?: string;
  pendingConfirmation?: {
    id: string;
    action: string;
    objectType: string;
    expiresAt: number;
  };
}

export function validateChannelMessage(msg: unknown): msg is ChannelMessage {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as Record<string, unknown>;

  const validChannels: ChannelType[] = ["teams", "slack", "mcp", "chatgpt", "web"];
  const validScopes: ConversationScope[] = ["personal", "groupChat", "teams", "dm", "channel", "api"];
  const validRoles: UserRole[] = ["admin", "member"];
  const validFirmSizes: FirmSize[] = ["solo", "small", "mid", "large"];

  if (!validChannels.includes(m.channel as ChannelType)) return false;
  if (typeof m.orgId !== "string" || !m.orgId) return false;
  if (typeof m.userId !== "string" || !m.userId) return false;
  if (!validRoles.includes(m.userRole as UserRole)) return false;
  if (typeof m.conversationId !== "string" || !m.conversationId) return false;
  if (!validScopes.includes(m.conversationScope as ConversationScope)) return false;
  if (typeof m.message !== "string") return false;
  if (m.jurisdiction !== null && typeof m.jurisdiction !== "string") return false;
  if (m.practiceType !== null && typeof m.practiceType !== "string") return false;
  if (m.firmSize !== null && !validFirmSizes.includes(m.firmSize as FirmSize)) return false;

  return true;
}
