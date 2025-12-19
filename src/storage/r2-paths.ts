/**
 * R2 Storage Path Utilities
 *
 * All R2 objects are namespaced by organization to ensure data isolation.
 * Structure: orgs/{orgId}/{category}/{...}
 */

// ============================================================================
// Path Builders
// ============================================================================

export const R2Paths = {
  /**
   * Path for organization documents (context files, uploads)
   * @example "orgs/acme-law/docs/doc-123"
   */
  orgDoc(orgId: string, fileId: string): string {
    return `orgs/${orgId}/docs/${fileId}`;
  },

  /**
   * Prefix for listing audit log entries by date
   * @example "orgs/acme-law/audit/2025/01/15/"
   */
  auditLogPrefix(orgId: string, year: number, month: number, day?: number): string {
    const paddedMonth = month.toString().padStart(2, "0");
    if (day) {
      const paddedDay = day.toString().padStart(2, "0");
      return `orgs/${orgId}/audit/${year}/${paddedMonth}/${paddedDay}/`;
    }
    return `orgs/${orgId}/audit/${year}/${paddedMonth}/`;
  },

  /**
   * Path for archived conversation history
   * @example "orgs/acme-law/conversations/conv-456.json"
   */
  archivedConversation(orgId: string, conversationId: string): string {
    return `orgs/${orgId}/conversations/${conversationId}.json`;
  },
};
