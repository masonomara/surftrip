// Migration SQL statements for testing - single line format for D1 exec()

export const migrations = [
  // 0000_init-auth.sql - user table first (referenced by others)
  "CREATE TABLE IF NOT EXISTS `user` (`id` text PRIMARY KEY NOT NULL, `name` text NOT NULL, `email` text NOT NULL, `email_verified` integer DEFAULT false NOT NULL, `image` text, `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL, `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL)",
  "CREATE UNIQUE INDEX IF NOT EXISTS `user_email_unique` ON `user` (`email`)",
  "CREATE TABLE IF NOT EXISTS `session` (`id` text PRIMARY KEY NOT NULL, `expires_at` integer NOT NULL, `token` text NOT NULL, `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL, `updated_at` integer NOT NULL, `ip_address` text, `user_agent` text, `user_id` text NOT NULL, FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade)",
  "CREATE UNIQUE INDEX IF NOT EXISTS `session_token_unique` ON `session` (`token`)",
  "CREATE INDEX IF NOT EXISTS `session_userId_idx` ON `session` (`user_id`)",
  "CREATE TABLE IF NOT EXISTS `account` (`id` text PRIMARY KEY NOT NULL, `account_id` text NOT NULL, `provider_id` text NOT NULL, `user_id` text NOT NULL, `access_token` text, `refresh_token` text, `id_token` text, `access_token_expires_at` integer, `refresh_token_expires_at` integer, `scope` text, `password` text, `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL, `updated_at` integer NOT NULL, FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade)",
  "CREATE INDEX IF NOT EXISTS `account_userId_idx` ON `account` (`user_id`)",
  "CREATE TABLE IF NOT EXISTS `verification` (`id` text PRIMARY KEY NOT NULL, `identifier` text NOT NULL, `value` text NOT NULL, `expires_at` integer NOT NULL, `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL, `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL)",
  "CREATE INDEX IF NOT EXISTS `verification_identifier_idx` ON `verification` (`identifier`)",

  // 0001_create_org_tables.sql
  "CREATE TABLE IF NOT EXISTS `org` (`id` text PRIMARY KEY NOT NULL, `name` text NOT NULL, `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL, `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL)",
  "CREATE TABLE IF NOT EXISTS `workspace_bindings` (`id` text PRIMARY KEY NOT NULL, `channel_type` text NOT NULL CHECK (`channel_type` IN ('teams', 'slack')), `workspace_id` text NOT NULL, `org_id` text NOT NULL, `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL, FOREIGN KEY (`org_id`) REFERENCES `org`(`id`) ON UPDATE no action ON DELETE cascade)",
  "CREATE UNIQUE INDEX IF NOT EXISTS `workspace_bindings_workspace_idx` ON `workspace_bindings` (`channel_type`, `workspace_id`)",
  "CREATE INDEX IF NOT EXISTS `workspace_bindings_org_idx` ON `workspace_bindings` (`org_id`)",
  "CREATE TABLE IF NOT EXISTS `channel_user_links` (`id` text PRIMARY KEY NOT NULL, `channel_type` text NOT NULL CHECK (`channel_type` IN ('teams', 'slack')), `channel_user_id` text NOT NULL, `user_id` text NOT NULL, `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL, FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade)",
  "CREATE UNIQUE INDEX IF NOT EXISTS `channel_user_links_channel_idx` ON `channel_user_links` (`channel_type`, `channel_user_id`)",
  "CREATE INDEX IF NOT EXISTS `channel_user_links_user_idx` ON `channel_user_links` (`user_id`)",
  "CREATE TABLE IF NOT EXISTS `invitations` (`id` text PRIMARY KEY NOT NULL, `email` text NOT NULL, `org_id` text NOT NULL, `role` text NOT NULL DEFAULT 'member' CHECK (`role` IN ('owner', 'admin', 'member')), `invited_by` text NOT NULL, `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL, `expires_at` integer NOT NULL, `accepted_at` integer, FOREIGN KEY (`org_id`) REFERENCES `org`(`id`) ON UPDATE no action ON DELETE cascade, FOREIGN KEY (`invited_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade)",
  "CREATE INDEX IF NOT EXISTS `invitations_email_idx` ON `invitations` (`email`)",
  "CREATE INDEX IF NOT EXISTS `invitations_org_idx` ON `invitations` (`org_id`)",
  "CREATE TABLE IF NOT EXISTS `api_keys` (`id` text PRIMARY KEY NOT NULL, `user_id` text NOT NULL, `org_id` text NOT NULL, `key_hash` text NOT NULL, `key_prefix` text NOT NULL, `name` text NOT NULL, `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL, `last_used_at` integer, `revoked_at` integer, FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade, FOREIGN KEY (`org_id`) REFERENCES `org`(`id`) ON UPDATE no action ON DELETE cascade)",
  "CREATE INDEX IF NOT EXISTS `api_keys_user_idx` ON `api_keys` (`user_id`)",
  "CREATE INDEX IF NOT EXISTS `api_keys_org_idx` ON `api_keys` (`org_id`)",
  "CREATE UNIQUE INDEX IF NOT EXISTS `api_keys_hash_idx` ON `api_keys` (`key_hash`)",

  // 0002_create_subscription_tables.sql
  "CREATE TABLE IF NOT EXISTS `org_members` (`id` text PRIMARY KEY NOT NULL, `user_id` text NOT NULL, `org_id` text NOT NULL, `role` text NOT NULL DEFAULT 'member' CHECK (`role` IN ('owner', 'admin', 'member')), `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL, FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade, FOREIGN KEY (`org_id`) REFERENCES `org`(`id`) ON UPDATE no action ON DELETE cascade)",
  "CREATE UNIQUE INDEX IF NOT EXISTS `org_members_user_org_idx` ON `org_members` (`user_id`, `org_id`)",
  "CREATE INDEX IF NOT EXISTS `org_members_org_idx` ON `org_members` (`org_id`)",
  "CREATE TABLE IF NOT EXISTS `subscriptions` (`id` text PRIMARY KEY NOT NULL, `org_id` text NOT NULL UNIQUE, `tier` text NOT NULL DEFAULT 'free' CHECK (`tier` IN ('free', 'starter', 'professional', 'enterprise')), `status` text NOT NULL DEFAULT 'active' CHECK (`status` IN ('active', 'past_due', 'canceled', 'trialing')), `stripe_customer_id` text, `stripe_subscription_id` text, `current_period_start` integer, `current_period_end` integer, `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL, `updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL, FOREIGN KEY (`org_id`) REFERENCES `org`(`id`) ON UPDATE no action ON DELETE cascade)",
  "CREATE INDEX IF NOT EXISTS `subscriptions_org_idx` ON `subscriptions` (`org_id`)",
  "CREATE TABLE IF NOT EXISTS `tier_limits` (`tier` text PRIMARY KEY NOT NULL CHECK (`tier` IN ('free', 'starter', 'professional', 'enterprise')), `max_users` integer NOT NULL, `max_queries_per_day` integer NOT NULL, `max_context_docs` integer NOT NULL, `max_doc_size_mb` integer NOT NULL, `clio_read` integer NOT NULL DEFAULT 1, `clio_write` integer NOT NULL DEFAULT 0)",
  "INSERT OR IGNORE INTO `tier_limits` (`tier`, `max_users`, `max_queries_per_day`, `max_context_docs`, `max_doc_size_mb`, `clio_read`, `clio_write`) VALUES ('free', 1, 25, 5, 10, 1, 0), ('starter', 5, 100, 25, 25, 1, 1), ('professional', 25, 500, 100, 50, 1, 1), ('enterprise', -1, -1, -1, 100, 1, 1)",
  "CREATE TABLE IF NOT EXISTS `role_permissions` (`role` text NOT NULL CHECK (`role` IN ('owner', 'admin', 'member')), `permission` text NOT NULL, `allowed` integer NOT NULL DEFAULT 0, PRIMARY KEY (`role`, `permission`))",
  "INSERT OR IGNORE INTO `role_permissions` (`role`, `permission`, `allowed`) VALUES ('owner', 'org_manage', 1), ('owner', 'org_billing', 1), ('owner', 'org_invite', 1), ('owner', 'org_context_manage', 1), ('owner', 'clio_read', 1), ('owner', 'clio_create', 1), ('owner', 'clio_update', 1), ('owner', 'clio_delete', 1), ('admin', 'org_manage', 0), ('admin', 'org_billing', 0), ('admin', 'org_invite', 1), ('admin', 'org_context_manage', 1), ('admin', 'clio_read', 1), ('admin', 'clio_create', 1), ('admin', 'clio_update', 1), ('admin', 'clio_delete', 1), ('member', 'org_manage', 0), ('member', 'org_billing', 0), ('member', 'org_invite', 0), ('member', 'org_context_manage', 0), ('member', 'clio_read', 1), ('member', 'clio_create', 0), ('member', 'clio_update', 0), ('member', 'clio_delete', 0)",

  // 0003_create_kb_tables.sql
  "CREATE TABLE IF NOT EXISTS `kb_chunks` (`id` text PRIMARY KEY NOT NULL, `content` text NOT NULL, `source` text NOT NULL, `section` text, `chunk_index` integer NOT NULL, `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL)",
  "CREATE INDEX IF NOT EXISTS `kb_chunks_source_idx` ON `kb_chunks` (`source`)",
  "CREATE TABLE IF NOT EXISTS `kb_formulas` (`id` text PRIMARY KEY NOT NULL, `name` text NOT NULL, `formula` text NOT NULL, `description` text, `source` text NOT NULL, `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL)",
  "CREATE INDEX IF NOT EXISTS `kb_formulas_source_idx` ON `kb_formulas` (`source`)",
  "CREATE TABLE IF NOT EXISTS `kb_benchmarks` (`id` text PRIMARY KEY NOT NULL, `name` text NOT NULL, `value` text NOT NULL, `unit` text, `context` text, `source` text NOT NULL, `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL)",
  "CREATE INDEX IF NOT EXISTS `kb_benchmarks_source_idx` ON `kb_benchmarks` (`source`)",
  "CREATE TABLE IF NOT EXISTS `org_context_chunks` (`id` text PRIMARY KEY NOT NULL, `org_id` text NOT NULL, `file_id` text NOT NULL, `content` text NOT NULL, `source` text NOT NULL, `chunk_index` integer NOT NULL, `created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL, FOREIGN KEY (`org_id`) REFERENCES `org`(`id`) ON UPDATE no action ON DELETE cascade)",
  "CREATE INDEX IF NOT EXISTS `org_context_chunks_org_idx` ON `org_context_chunks` (`org_id`)",
  "CREATE INDEX IF NOT EXISTS `org_context_chunks_file_idx` ON `org_context_chunks` (`org_id`, `file_id`)",
];

export async function applyMigrations(db: D1Database): Promise<void> {
  for (const sql of migrations) {
    await db.exec(sql);
  }
}
