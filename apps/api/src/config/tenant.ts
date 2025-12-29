/**
 * Tenant Durable Object Configuration
 *
 * Central config for conversation, confirmation, and maintenance settings.
 */

export const TENANT_CONFIG = {
  // Conversation context
  RECENT_MESSAGES_LIMIT: 15, // Messages to include in LLM context

  // Confirmation timeouts
  CONFIRMATION_TTL_MS: 5 * 60 * 1000, // 5 minutes until confirmation expires

  // Maintenance scheduling
  ALARM_INTERVAL_MS: 24 * 60 * 60 * 1000, // Daily maintenance runs
  STALE_CONVERSATION_MS: 30 * 24 * 60 * 60 * 1000, // 30 days until archive
} as const;
