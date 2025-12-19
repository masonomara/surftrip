// R2 path helpers for consistent bucket organization

export const R2Paths = {
  // Document storage
  orgDoc: (orgId: string, fileId: string) => `orgs/${orgId}/docs/${fileId}`,

  // Audit logs (append-only JSONL)
  auditLog: (orgId: string, year: number, month: number) =>
    `orgs/${orgId}/audit/${year}/${month.toString().padStart(2, "0")}.jsonl`,

  // Archived conversations (>30 days old)
  archivedConversation: (orgId: string, conversationId: string) =>
    `orgs/${orgId}/conversations/${conversationId}.json`,
};

// Audit entry with hash chaining for tamper detection
export interface AuditEntry {
  id: string;
  user_id: string;
  action: string; // "clio_create", "clio_update", "clio_delete", etc.
  object_type: string; // "Matter", "Contact", etc.
  params: Record<string, unknown>;
  result: "success" | "error";
  error_message?: string;
  created_at: string;
  prev_hash: string; // SHA-256 of previous entry
}

async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function appendAuditLog(
  r2: R2Bucket,
  orgId: string,
  entry: Omit<AuditEntry, "id" | "created_at" | "prev_hash">
): Promise<void> {
  const now = new Date();
  const path = R2Paths.auditLog(orgId, now.getFullYear(), now.getMonth() + 1);

  // Get existing log to find prev_hash
  const existing = await r2.get(path);
  let prevHash = "genesis";
  let existingContent = "";

  if (existing) {
    existingContent = await existing.text();
    const lines = existingContent.trim().split("\n");
    if (lines.length > 0 && lines[lines.length - 1]) {
      const lastEntry = JSON.parse(lines[lines.length - 1]);
      prevHash = await sha256(JSON.stringify(lastEntry));
    }
  }

  const fullEntry: AuditEntry = {
    id: crypto.randomUUID(),
    created_at: now.toISOString(),
    prev_hash: prevHash,
    ...entry,
  };

  const newLine = JSON.stringify(fullEntry) + "\n";
  const newContent = existingContent + newLine;

  await r2.put(path, newContent, {
    httpMetadata: { contentType: "application/x-ndjson" },
  });
}
