# Phase 3: Storage Layer Tutorial

**LONGER DOC**

This tutorial walks through setting up all storage schemas and structures for Docket. By the end, you'll have a working D1 database with all tables, Vectorize configured for multi-tenant semantic search, and R2 organized for document storage.

## What We're Building

Phase 2 created the raw infrastructure—empty D1 database, blank R2 bucket, Vectorize index. Phase 3 fills them with structure:

```
D1 Database
├── Auth tables (Better Auth)     → User accounts, sessions
├── Cross-tenant tables           → Orgs, workspace bindings, invitations
├── Subscription tables           → Billing tiers, permissions
└── Knowledge Base tables         → Shared KB + per-org context

Vectorize Index
├── Shared KB embeddings          → No metadata filter
└── Org Context embeddings        → Filtered by { org_id }

R2 Bucket
└── /orgs/{org_id}/
    ├── docs/{file_id}            → Uploaded documents
    ├── audit/{year}/{month}.jsonl → Tamper-evident logs
    └── conversations/            → Archived chats (>30 days)
```

**Why this structure?** D1 handles relational data with foreign keys and indexes. Vectorize enables semantic search across documents. R2 stores large files that don't belong in a database. The DO SQLite (per-org) stores conversation state—that's Phase 6.

## Part 1: D1 Migrations Setup

### 1.1 Understanding D1 Migrations

D1 migrations are versioned `.sql` files that evolve your schema. Cloudflare tracks which migrations have run in a `d1_migrations` table, so each migration executes exactly once.

```
migrations/
├── 0001_create_auth_tables.sql      → Better Auth foundation
├── 0002_create_org_tables.sql       → Multi-tenancy
├── 0003_create_subscription_tables.sql → Billing
└── 0004_create_kb_tables.sql        → Knowledge Base
```

Each file is numbered sequentially. Wrangler applies them in order, skipping already-applied migrations.

**Key commands:**

```bash
# Create a new migration file
npx wrangler d1 migrations create docket-db <migration_name>

# List pending migrations
npx wrangler d1 migrations list docket-db --local

# Apply migrations locally
npx wrangler d1 migrations apply docket-db --local

# Apply to production
npx wrangler d1 migrations apply docket-db --remote
```

### 1.2 Create the Migrations Folder

```bash
mkdir -p migrations
```

### 1.3 Migration 1: Auth Tables (Better Auth)

Better Auth expects specific table names and columns. We create these manually to control the schema and avoid drift.

Create `migrations/0001_create_auth_tables.sql`

**Tables:** `user`, `session`, `account`, `verification`

**What's happening here:**

- `user` stores Docket accounts (email/password or OAuth)
- `session` tracks who's logged into the web dashboard
- `account` links OAuth providers (if user signs up via Google)
- `verification` handles email verification and password reset flows

**Important:** This is NOT where Teams/Slack users are stored. Channel identities link to these accounts via `channel_user_links` (next migration).

### 1.4 Migration 2: Organization Tables

Create `migrations/0002_create_org_tables.sql`

**Tables:** `org`, `workspace_bindings`, `channel_user_links`, `invitations`, `api_keys`

**Identity flow explained:**

1. User sends message from Teams
2. Bot Framework gives us `teamsUserId`
3. Query `channel_user_links` for matching `channel_user_id`
4. If found → have `user_id` → fetch Docket user
5. If not found → trigger linking flow (OAuthCard → Azure AD SSO)
6. After linking → store mapping in `channel_user_links`

**Why separate `workspace_bindings`?** When a Teams admin installs Docket for their tenant, we need to know which Docket org that Teams workspace belongs to. One workspace = one org.

### 1.5 Migration 3: Subscriptions & Permissions

Create `migrations/0003_create_subscription_tables.sql`

**Tables:** `org_members`, `subscriptions`, `tier_limits`, `role_permissions`

**Why `org_members` here?** The `role` column in `org_members` ties directly to `role_permissions`. User access is determined by role → permissions lookup. Grouping these together keeps the access control logic in one migration.

**How permission checking works:**

```typescript
// In the DO, before executing a Clio operation
const canDelete = await db
  .prepare(
    `
  SELECT allowed FROM role_permissions
  WHERE role = ? AND permission = 'clio_delete'
`
  )
  .bind(userRole)
  .first();

if (!canDelete?.allowed) {
  return { error: "You don't have permission to delete Clio records" };
}
```

### 1.6 Migration 4: Knowledge Base Tables

Create `migrations/0004_create_kb_tables.sql`

**Tables:** `kb_chunks`, `kb_formulas`, `kb_benchmarks`, `org_context_chunks`

**Two different populations:**

1. **Shared KB** (`kb_chunks`, `kb_formulas`, `kb_benchmarks`): Populated at deploy time via a build script. Contains Clio workflows, deadline calculations, billing guidance.

2. **Org Context** (`org_context_chunks`): Populated at runtime when admins upload documents. Firm-specific procedures, templates, billing rates.

### 1.7 Apply Migrations

Run all migrations locally first:

```bash
# Create migration files (if using wrangler generate)
npx wrangler d1 migrations create docket-db create_auth_tables
npx wrangler d1 migrations create docket-db create_org_tables
npx wrangler d1 migrations create docket-db create_subscription_tables
npx wrangler d1 migrations create docket-db create_kb_tables

# Apply locally
npx wrangler d1 migrations apply docket-db --local

# Verify tables exist
npx wrangler d1 execute docket-db --local --command "SELECT name FROM sqlite_master WHERE type='table'"
```

Expected output:

```
┌───────────────────────┐
│ name                  │
├───────────────────────┤
│ d1_migrations         │
│ user                  │
│ session               │
│ account               │
│ verification          │
│ org                   │
│ org_members           │
│ workspace_bindings    │
│ channel_user_links    │
│ invitations           │
│ api_keys              │
│ tier_limits           │
│ subscriptions         │
│ role_permissions      │
│ kb_chunks             │
│ kb_formulas           │
│ kb_benchmarks         │
│ org_context_chunks    │
└───────────────────────┘
```

## Part 2: Vectorize Metadata Setup

Vectorize stores embeddings for semantic search. We need metadata filtering to separate shared KB from org-specific content.

### 2.1 Create Metadata Index

The Vectorize index exists from Phase 2. Now add a metadata index for `org_id`:

```bash
npx wrangler vectorize create-metadata-index docket-vectors \
  --property-name=org_id \
  --type=string
```

This enables filtering queries by `org_id`. Without it, you can't isolate org-specific embeddings.

## Part 3: R2 Path Structure

R2 stores files too large for D1—uploaded documents, audit logs, archived conversations.

### 3.1 Directory Structure

```
/orgs/{org_id}/
├── docs/
│   └── {file_id}              → Original uploaded files (PDF, DOCX, MD)
├── audit/
│   └── {year}/
│       └── {month}.jsonl      → Append-only audit logs
└── conversations/
    └── {conversation_id}.json → Archived conversations (>30 days)
```

### 3.2 Path Helpers

Create a utility for consistent paths

### 3.3 Audit Log Format

Each audit entry is a JSON line with hash chaining for tamper detection:

**Why hash chaining?** Each entry includes the hash of the previous entry. If someone modifies an old entry, all subsequent hashes become invalid. Auditors can verify the chain hasn't been tampered with.

## Part 4: Testing

### 4.1 Unit Tests for Migrations

Create `test/storage.spec.ts`:

### 4.2 Integration Tests for Vectorize

### 4.3 R2 Path Tests

## Part 5: Demo Component

Update the demo page to verify Phase 3 completion.

Add to `src/index.ts` a new route `/demo/storage` that verifies:

1. All D1 tables exist
2. Tier limits are seeded
3. Role permissions are seeded
4. Vectorize accepts metadata
5. R2 path structure works

## Checklist

Before marking Phase 3 complete:


