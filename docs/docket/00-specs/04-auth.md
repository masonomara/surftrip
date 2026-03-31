# Docket Auth

## Docket Account Auth (Better Auth + D1)

For signing into Docket, we chose Better Auth because it's free and has native Cloudflare Workers + D1 support. Third-party library absorbs security vulnerabilities when handling legal data. Better Auth stores user accounts, passwords, and sessions in Cloudflare D1. We own the data. No external service stores user credentials or Clio tokens.

### Better Auth + Cloudflare Setup

**1. Wrangler compatibility flags:**

Better Auth requires `AsyncLocalStorage` for async context tracking. Add to `wrangler.toml`:

```toml
compatibility_flags = ["nodejs_compat"]
compatibility_date = "2024-09-23"
```

**2. Database tables (migrations):**

Write D1 tables manually to match Better Auth's expected schema (~4 tables: `user`, `session`, `account`, `verification`), apply via `wrangler d1 migrations apply`, and lock Better Auth version in package.json to prevent schema drift.

**3. Runtime initialization:**

Cloudflare Workers only expose database bindings (`env.DB`) inside request handlers, not at module load. Use a factory function:

```ts
export function getAuth(env: Env) {
  const db = drizzle(env.DB);
  return betterAuth({
    database: drizzleAdapter(db, { provider: "sqlite" }),
  });
}
```

## Channel Identity Linking

When a user messages from a channel, the system needs to map the channel's user ID to the Docket user ID. Each channel has its own identity system, and first-time users must link their channel identity to their Docket account. Links stored in D1 `channel_user_links` table:

- Web: User identified by Better Auth login state (cookie)
- Teams/Slack: User identified by Teams/Slack User ID → D1 lookup → Docket user
- MCP: User identified by API key → D1 lookup → Docket user
- ChatGPT: User identified by OAuth flow → Docket user

## Clio OAuth

OAuth lets users grant Docket permission to access their Clio data without sharing their Clio password. User clicks "Connect Clio," gets redirected to Clio, approves access, and Clio returns a token. Token stored in DO Storage, used when Docket queries Clio on that user's behalf. Once resolved to a Docket user, Clio token is fetched from DO Storage.

## Clio Token Refresh

Stored encrypted (AES-GCM) in DO Storage, keyed by user_id: `access_token`, `refresh_token`, and `expires_at` (Unix timestamp). Access tokens expire after 7 days. Refresh tokens never expire but can be revoked by user in Clio.

**Proactive refresh (before Clio calls):**

```ts
if (token.expires_at && Date.now() > token.expires_at - 300_000) {
  token = await refreshClioToken(token); // Within 5 min of expiry
}
```

**Reactive refresh (on 401):**

1. Clio API returns 401 → DO reads `refresh_token` from storage
2. POST `https://app.clio.com/oauth/token` with `grant_type=refresh_token`
3. SUCCESS: store new `access_token`, `expires_at`, retry original request once
4. FAILURE (`invalid_grant`): mark `clio_connected=false`, return re-auth message

## Auth Flows

**Website Signup:**

1. Better Auth handles registration → user record created in D1
2. Session created, stored in D1 `session` table
3. Check D1 `invitations` for email match → if found, link user to org_id
4. User connects Clio → tokens stored in DO Storage (encrypted, per-user)

**Teams Linking:**

1. Message arrives with Teams user ID (Bot Framework provides this)
2. D1 lookup: `channel_user_links` for existing link
3. Not linked:
   - OAuthCard triggers Azure AD SSO → returns Microsoft email
   - D1 lookup: does email match a Docket user?
   - Match: insert link into `channel_user_links` (Teams ID → Docket user_id)
   - No match: return "account not found" response
4. Linked: fetch user record from D1, Clio token from DO → proceed

**Slack Linking:**

1. Message arrives with Slack user ID (Events API provides this)
2. D1 lookup: `channel_user_links` for existing link
3. Not linked:
   - Generate magic link code, store in D1 (needs: expiry, single-use, rate limiting, brute-force protection)
   - User clicks link → validates code → D1 lookup for Docket user
   - Insert link into `channel_user_links` (Slack ID → Docket user_id)
4. Linked: fetch user record from D1, Clio token from DO → proceed

**Invitation:**

1. Admin submits email + role → stored in D1 `invitations` table
2. On signup: Better Auth creates user → check `invitations` for email
3. Match found: link user to org, mark invitation accepted in D1
