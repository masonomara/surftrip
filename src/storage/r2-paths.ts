/**
 * R2 Storage Path Builders
 *
 * Centralizes all R2 bucket path construction to ensure consistent
 * naming conventions across the codebase.
 *
 * Bucket structure:
 *   orgs/{orgId}/
 *     docs/{fileId}              - uploaded org context files
 *     audit/{year}/{month}/{day}/ - audit log entries
 *     conversations/{id}.json    - archived conversation history
 */

export const R2Paths = {
  /**
   * Path to an org's uploaded document
   * Example: orgs/abc123/docs/file-uuid
   */
  orgDoc(orgId: string, fileId: string): string {
    return `orgs/${orgId}/docs/${fileId}`;
  },

  /**
   * Prefix for audit log entries. Can filter by year/month/day.
   *
   * Examples:
   *   orgs/abc123/audit/2024/         - all of 2024
   *   orgs/abc123/audit/2024/03/      - March 2024
   *   orgs/abc123/audit/2024/03/15/   - March 15, 2024
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
   * Path to an archived conversation
   * Example: orgs/abc123/conversations/conv-uuid.json
   */
  archivedConversation(orgId: string, conversationId: string): string {
    return `orgs/${orgId}/conversations/${conversationId}.json`;
  },
};
