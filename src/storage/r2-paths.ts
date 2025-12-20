/**
 * Helper functions for generating consistent R2 storage paths.
 * All paths follow the pattern: orgs/{orgId}/{resource-type}/...
 */
export const R2Paths = {
  /**
   * Path for storing organization documents
   * Example: orgs/acme-corp/docs/doc-123
   */
  orgDoc(orgId: string, fileId: string): string {
    return `orgs/${orgId}/docs/${fileId}`;
  },

  /**
   * Prefix for audit log entries (for listing/filtering)
   * Example: orgs/acme-corp/audit/2025/01/ or orgs/acme-corp/audit/2025/01/15/
   */
  auditLogPrefix(
    orgId: string,
    year: number,
    month: number,
    day?: number
  ): string {
    const monthStr = month.toString().padStart(2, "0");
    const dayStr = day ? `${day.toString().padStart(2, "0")}/` : "";

    return `orgs/${orgId}/audit/${year}/${monthStr}/${dayStr}`;
  },

  /**
   * Path for archived conversation JSON files
   * Example: orgs/acme-corp/conversations/conv-456.json
   */
  archivedConversation(orgId: string, conversationId: string): string {
    return `orgs/${orgId}/conversations/${conversationId}.json`;
  },
};
