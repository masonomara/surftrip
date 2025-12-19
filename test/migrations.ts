/**
 * Database Migrations for Testing
 *
 * These migrations create the complete schema for testing.
 * Uses "IF NOT EXISTS" to allow re-running safely.
 */

export const migrations = [
  // ============================================================================
  // Auth Tables (Better Auth)
  // ============================================================================

  // Users table
  "CREATE TABLE IF NOT EXISTS user (" +
    "id TEXT PRIMARY KEY NOT NULL, " +
    "name TEXT NOT NULL, " +
    "email TEXT NOT NULL, " +
    "email_verified INTEGER DEFAULT false NOT NULL, " +
    "image TEXT, " +
    "created_at INTEGER DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL, " +
    "updated_at INTEGER DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL" +
    ")",

  "CREATE UNIQUE INDEX IF NOT EXISTS user_email_unique ON user (email)",

  // Sessions table
  "CREATE TABLE IF NOT EXISTS session (" +
    "id TEXT PRIMARY KEY NOT NULL, " +
    "expires_at INTEGER NOT NULL, " +
    "token TEXT NOT NULL, " +
    "created_at INTEGER DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL, " +
    "updated_at INTEGER NOT NULL, " +
    "ip_address TEXT, " +
    "user_agent TEXT, " +
    "user_id TEXT NOT NULL, " +
    "FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE" +
    ")",

  "CREATE UNIQUE INDEX IF NOT EXISTS session_token_unique ON session (token)",
  "CREATE INDEX IF NOT EXISTS session_userId_idx ON session (user_id)",

  // OAuth accounts table
  "CREATE TABLE IF NOT EXISTS account (" +
    "id TEXT PRIMARY KEY NOT NULL, " +
    "account_id TEXT NOT NULL, " +
    "provider_id TEXT NOT NULL, " +
    "user_id TEXT NOT NULL, " +
    "access_token TEXT, " +
    "refresh_token TEXT, " +
    "id_token TEXT, " +
    "access_token_expires_at INTEGER, " +
    "refresh_token_expires_at INTEGER, " +
    "scope TEXT, " +
    "password TEXT, " +
    "created_at INTEGER DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL, " +
    "updated_at INTEGER NOT NULL, " +
    "FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE" +
    ")",

  "CREATE INDEX IF NOT EXISTS account_userId_idx ON account (user_id)",

  // Email verification table
  "CREATE TABLE IF NOT EXISTS verification (" +
    "id TEXT PRIMARY KEY NOT NULL, " +
    "identifier TEXT NOT NULL, " +
    "value TEXT NOT NULL, " +
    "expires_at INTEGER NOT NULL, " +
    "created_at INTEGER DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL, " +
    "updated_at INTEGER DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL" +
    ")",

  "CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification (identifier)",

  // ============================================================================
  // Organization Tables
  // ============================================================================

  // Organizations
  "CREATE TABLE IF NOT EXISTS org (" +
    "id TEXT PRIMARY KEY NOT NULL, " +
    "name TEXT NOT NULL, " +
    "created_at INTEGER DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL, " +
    "updated_at INTEGER DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL" +
    ")",

  // Teams/Slack workspace bindings
  "CREATE TABLE IF NOT EXISTS workspace_bindings (" +
    "id TEXT PRIMARY KEY NOT NULL, " +
    "channel_type TEXT NOT NULL CHECK (channel_type IN ('teams', 'slack')), " +
    "workspace_id TEXT NOT NULL, " +
    "org_id TEXT NOT NULL, " +
    "created_at INTEGER DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL, " +
    "FOREIGN KEY (org_id) REFERENCES org(id) ON DELETE CASCADE" +
    ")",

  "CREATE UNIQUE INDEX IF NOT EXISTS workspace_bindings_workspace_idx ON workspace_bindings (channel_type, workspace_id)",
  "CREATE INDEX IF NOT EXISTS workspace_bindings_org_idx ON workspace_bindings (org_id)",

  // Channel user links (Teams/Slack users to Docket users)
  "CREATE TABLE IF NOT EXISTS channel_user_links (" +
    "id TEXT PRIMARY KEY NOT NULL, " +
    "channel_type TEXT NOT NULL CHECK (channel_type IN ('teams', 'slack')), " +
    "channel_user_id TEXT NOT NULL, " +
    "user_id TEXT NOT NULL, " +
    "created_at INTEGER DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL, " +
    "FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE" +
    ")",

  "CREATE UNIQUE INDEX IF NOT EXISTS channel_user_links_channel_idx ON channel_user_links (channel_type, channel_user_id)",
  "CREATE INDEX IF NOT EXISTS channel_user_links_user_idx ON channel_user_links (user_id)",

  // Organization invitations
  "CREATE TABLE IF NOT EXISTS invitations (" +
    "id TEXT PRIMARY KEY NOT NULL, " +
    "email TEXT NOT NULL, " +
    "org_id TEXT NOT NULL, " +
    "role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')), " +
    "invited_by TEXT NOT NULL, " +
    "created_at INTEGER DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL, " +
    "expires_at INTEGER NOT NULL, " +
    "accepted_at INTEGER, " +
    "FOREIGN KEY (org_id) REFERENCES org(id) ON DELETE CASCADE, " +
    "FOREIGN KEY (invited_by) REFERENCES user(id) ON DELETE CASCADE" +
    ")",

  "CREATE INDEX IF NOT EXISTS invitations_email_idx ON invitations (email)",
  "CREATE INDEX IF NOT EXISTS invitations_org_idx ON invitations (org_id)",

  // API keys
  "CREATE TABLE IF NOT EXISTS api_keys (" +
    "id TEXT PRIMARY KEY NOT NULL, " +
    "user_id TEXT NOT NULL, " +
    "org_id TEXT NOT NULL, " +
    "key_hash TEXT NOT NULL, " +
    "key_prefix TEXT NOT NULL, " +
    "hash_version INTEGER NOT NULL DEFAULT 1, " +
    "name TEXT NOT NULL, " +
    "created_at INTEGER DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL, " +
    "last_used_at INTEGER, " +
    "revoked_at INTEGER, " +
    "FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE, " +
    "FOREIGN KEY (org_id) REFERENCES org(id) ON DELETE CASCADE" +
    ")",

  "CREATE INDEX IF NOT EXISTS api_keys_user_idx ON api_keys (user_id)",
  "CREATE INDEX IF NOT EXISTS api_keys_org_idx ON api_keys (org_id)",
  "CREATE UNIQUE INDEX IF NOT EXISTS api_keys_hash_idx ON api_keys (key_hash)",

  // ============================================================================
  // Subscription Tables
  // ============================================================================

  // Organization members with roles
  "CREATE TABLE IF NOT EXISTS org_members (" +
    "id TEXT PRIMARY KEY NOT NULL, " +
    "user_id TEXT NOT NULL, " +
    "org_id TEXT NOT NULL, " +
    "role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')), " +
    "created_at INTEGER DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL, " +
    "FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE, " +
    "FOREIGN KEY (org_id) REFERENCES org(id) ON DELETE CASCADE" +
    ")",

  "CREATE UNIQUE INDEX IF NOT EXISTS org_members_user_org_idx ON org_members (user_id, org_id)",
  "CREATE INDEX IF NOT EXISTS org_members_org_idx ON org_members (org_id)",

  // Stripe subscriptions
  "CREATE TABLE IF NOT EXISTS subscriptions (" +
    "id TEXT PRIMARY KEY NOT NULL, " +
    "org_id TEXT NOT NULL UNIQUE, " +
    "tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'starter', 'professional', 'enterprise')), " +
    "status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'canceled', 'trialing')), " +
    "stripe_customer_id TEXT, " +
    "stripe_subscription_id TEXT, " +
    "current_period_start INTEGER, " +
    "current_period_end INTEGER, " +
    "created_at INTEGER DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL, " +
    "updated_at INTEGER DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL, " +
    "FOREIGN KEY (org_id) REFERENCES org(id) ON DELETE CASCADE" +
    ")",

  "CREATE INDEX IF NOT EXISTS subscriptions_org_idx ON subscriptions (org_id)",

  // Tier limits configuration
  "CREATE TABLE IF NOT EXISTS tier_limits (" +
    "tier TEXT PRIMARY KEY NOT NULL CHECK (tier IN ('free', 'starter', 'professional', 'enterprise')), " +
    "max_users INTEGER NOT NULL, " +
    "max_queries_per_day INTEGER NOT NULL, " +
    "max_context_docs INTEGER NOT NULL, " +
    "max_doc_size_mb INTEGER NOT NULL, " +
    "clio_read INTEGER NOT NULL DEFAULT 1, " +
    "clio_write INTEGER NOT NULL DEFAULT 0" +
    ")",

  // Seed tier limits (-1 means unlimited)
  "INSERT OR IGNORE INTO tier_limits (tier, max_users, max_queries_per_day, max_context_docs, max_doc_size_mb, clio_read, clio_write) VALUES " +
    "('free', 1, 25, 5, 10, 1, 0), " +
    "('starter', 5, 100, 25, 25, 1, 1), " +
    "('professional', 25, 500, 100, 50, 1, 1), " +
    "('enterprise', -1, -1, -1, 100, 1, 1)",

  // Role-based permissions
  "CREATE TABLE IF NOT EXISTS role_permissions (" +
    "role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')), " +
    "permission TEXT NOT NULL, " +
    "allowed INTEGER NOT NULL DEFAULT 0, " +
    "PRIMARY KEY (role, permission)" +
    ")",

  // Seed role permissions
  "INSERT OR IGNORE INTO role_permissions (role, permission, allowed) VALUES " +
    "('owner', 'org_manage', 1), " +
    "('owner', 'org_billing', 1), " +
    "('owner', 'org_invite', 1), " +
    "('owner', 'org_context_manage', 1), " +
    "('owner', 'clio_read', 1), " +
    "('owner', 'clio_create', 1), " +
    "('owner', 'clio_update', 1), " +
    "('owner', 'clio_delete', 1), " +
    "('admin', 'org_manage', 0), " +
    "('admin', 'org_billing', 0), " +
    "('admin', 'org_invite', 1), " +
    "('admin', 'org_context_manage', 1), " +
    "('admin', 'clio_read', 1), " +
    "('admin', 'clio_create', 1), " +
    "('admin', 'clio_update', 1), " +
    "('admin', 'clio_delete', 1), " +
    "('member', 'org_manage', 0), " +
    "('member', 'org_billing', 0), " +
    "('member', 'org_invite', 0), " +
    "('member', 'org_context_manage', 0), " +
    "('member', 'clio_read', 1), " +
    "('member', 'clio_create', 0), " +
    "('member', 'clio_update', 0), " +
    "('member', 'clio_delete', 0)",

  // ============================================================================
  // Knowledge Base Tables
  // ============================================================================

  // Shared knowledge base chunks
  "CREATE TABLE IF NOT EXISTS kb_chunks (" +
    "id TEXT PRIMARY KEY NOT NULL, " +
    "content TEXT NOT NULL, " +
    "source TEXT NOT NULL, " +
    "section TEXT, " +
    "chunk_index INTEGER NOT NULL, " +
    "created_at INTEGER DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL" +
    ")",

  "CREATE INDEX IF NOT EXISTS kb_chunks_source_idx ON kb_chunks (source)",

  // Extracted formulas
  "CREATE TABLE IF NOT EXISTS kb_formulas (" +
    "id TEXT PRIMARY KEY NOT NULL, " +
    "name TEXT NOT NULL, " +
    "formula TEXT NOT NULL, " +
    "description TEXT, " +
    "source TEXT NOT NULL, " +
    "created_at INTEGER DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL" +
    ")",

  "CREATE INDEX IF NOT EXISTS kb_formulas_source_idx ON kb_formulas (source)",

  // Industry benchmarks
  "CREATE TABLE IF NOT EXISTS kb_benchmarks (" +
    "id TEXT PRIMARY KEY NOT NULL, " +
    "name TEXT NOT NULL, " +
    "value TEXT NOT NULL, " +
    "unit TEXT, " +
    "context TEXT, " +
    "source TEXT NOT NULL, " +
    "created_at INTEGER DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL" +
    ")",

  "CREATE INDEX IF NOT EXISTS kb_benchmarks_source_idx ON kb_benchmarks (source)",

  // Organization-specific context chunks
  "CREATE TABLE IF NOT EXISTS org_context_chunks (" +
    "id TEXT PRIMARY KEY NOT NULL, " +
    "org_id TEXT NOT NULL, " +
    "file_id TEXT NOT NULL, " +
    "content TEXT NOT NULL, " +
    "source TEXT NOT NULL, " +
    "chunk_index INTEGER NOT NULL, " +
    "created_at INTEGER DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL, " +
    "FOREIGN KEY (org_id) REFERENCES org(id) ON DELETE CASCADE" +
    ")",

  "CREATE INDEX IF NOT EXISTS org_context_chunks_org_idx ON org_context_chunks (org_id)",
  "CREATE INDEX IF NOT EXISTS org_context_chunks_file_idx ON org_context_chunks (org_id, file_id)",
];

/**
 * Applies all migrations to the database
 */
export async function applyMigrations(db: D1Database): Promise<void> {
  for (const sql of migrations) {
    await db.exec(sql);
  }
}
