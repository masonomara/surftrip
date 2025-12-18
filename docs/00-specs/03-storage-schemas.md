# Docket Storage Schemas

## D1 Schema

**Tables:**

- Auth (Better Auth managed):
  - `user` - user accounts
  - `session` - active sessions
  - `account` - OAuth account links
- Cross-tenant:
  - `org` - org registry (org_id, name, created_at)
  - `workspace_bindings` - Teams/Slack workspace → org mapping
  - `channel_user_links` - channel user → Docket user (channel, channel_user_id, user_id, linked_at)
  - `api_keys` - API keys for MCP/ChatGPT access
  - `invitations` - pending org invitations
- Subscriptions & Permissions:
  - `subscriptions` - org billing (org_id, tier, status, stripe_id, period_end)
  - `tier_limits` - tier definitions (tier, max_admins, max_members, max_messages_mo)
  - `role_permissions` - role × permission matrix (role, permission, allowed)
  - `org_members` - user-org-role binding (user_id, org_id, role, is_owner)
- Knowledge Base (shared, buildtime):
  - `kb_chunks` - text chunks (chunk_id, text, source_file, section)
  - `kb_formulas` - useful shortcuts (formula_id, name, formula, source_file)
  - `kb_benchmarks` - reference metrics (benchmark_id, metric_name, value, source_file)
- Org Context (per-org, runtime):
  - `org_context_chunks` — per-org chunks (chunk_id, org_id, text, source_file)

**Indexes:**

- `kb_chunks` by source_file
- `kb_benchmarks` by type
- `org_context_chunks` by org_id

**Session Disambiguation:**

| Term         | Meaning                            | Storage         | Identifier       |
| ------------ | ---------------------------------- | --------------- | ---------------- |
| Auth session | Better Auth login state            | D1 `session`    | session token    |
| Conversation | Teams/Slack chat context + history | DO SQLite       | `conversationId` |
| Clio token   | OAuth credentials for Clio API     | DO Storage (KV) | `userId`         |

## DO SQLite Schema

**Tables:**

- Conversations (one per Teams/Slack conversation)
  - Ex. conversation_id (PK), user_id, scope, started_at, last_message_at
- Messages (LLM context window)
  - Ex. id, conversation_id, role, content, created_at
  - `conversation_id` references `conversations(conversation_id)`
- Pending Confirmations (CUD operations waiting approval)
  - Ex. id, conversation_id, user_id, operation, object_type, params, created_at, expires_at
- Org Settings
  - Ex. key, value
- Clio Schema (cached, refreshable via settings)
  - Ex. object_type, schema_json, fetched_at

**Indexes:**

- `idx_messages_conversation` on `messages(conversation_id)`
- `idx_pending_conversation` on `pending_confirmations(conversation_id)`
- `idx_pending_expires` on `pending_confirmations(expires_at)`

## R2 Audit Log Format

Path: `/orgs/{org_id}/audit/{year}/{month}.jsonl`

Each line is a JSON object:

```json
{
  "id": "uuid",
  "user_id": "...",
  "action": "...",
  "object_type": "...",
  "params": {},
  "result": "...",
  "created_at": "...",
  "prev_hash": "sha256-of-previous-entry"
}
```

`prev_hash` creates a hash chain for tamper detection. Multi-year retention.

### Clio Schema Structure

What we store per object:

```typescript
interface ClioSchema {
  type: string; // "Matter", "Contact", etc.
  fields: ClioField[];
}

interface ClioField {
  name: string; // "display_number"
  type: string; // "string", "integer", "date", "boolean"
  required?: boolean; // For create operations
  read_only?: boolean; // Can't be set via API
  enum?: string[]; // Valid values if constrained
  relationship?: boolean; // Links to another object (needs ID)
  description?: string; // From Clio, if provided
}
```
