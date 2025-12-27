# Email-First Authentication Flow

Consolidate login and signup into a single unified auth page with an email-first experience.

## Current State

Two separate routes:
- `/login` - email + password fields, "Need an account?" link
- `/signup` - name + email + password fields, "Already have an account?" link

Both support Google OAuth and handle invitation flows.

## Proposed Flow

```
┌─────────────────────────────────────┐
│           /auth                     │
│                                     │
│  [Continue with Google]             │
│                                     │
│  ─────────── or ───────────         │
│                                     │
│  Email: [________________]          │
│                                     │
│  [Continue]                         │
└─────────────────────────────────────┘
                 │
                 ▼
        ┌───────────────┐
        │ POST /api/    │
        │ check-email   │
        └───────┬───────┘
                │
       ┌────────┴────────┐
       │                 │
       ▼                 ▼
  exists: true      exists: false
       │                 │
       ▼                 ▼
┌─────────────┐   ┌─────────────────┐
│  STEP 2a    │   │    STEP 2b      │
│  Password   │   │  Name+Password  │
│  [______]   │   │  [______]       │
│             │   │  [______]       │
│  [Log in]   │   │  [Sign up]      │
└─────────────┘   └─────────────────┘
       │                 │
       ▼                 ▼
  signIn.email     signUp.email
       │                 │
       ▼                 ▼
   Dashboard      Verify Email
```

## API Design

### `POST /api/check-email`

Checks if an email is registered in the system.

**Request:**
```json
{ "email": "user@example.com" }
```

**Response:**
```json
{ "exists": true, "hasPassword": true }
```

**Fields:**
- `exists`: User record exists in `user` table
- `hasPassword`: User has a credential-based account (not just OAuth)

The `hasPassword` field handles the edge case where a user signed up with Google but has no password. In this case, we should prompt them to either:
- Sign in with Google, or
- Set a password via "Forgot password?"

### Implementation

```ts
// apps/api/src/handlers/auth.ts

export async function handleCheckEmail(
  request: Request,
  env: Env
): Promise<Response> {
  const body = await request.json();
  const email = body.email?.toLowerCase()?.trim();

  if (!email || !email.includes("@")) {
    return Response.json(
      { error: "Valid email required" },
      { status: 400 }
    );
  }

  // Query D1 directly - user table has unique index on email
  const user = await env.DB.prepare(
    "SELECT id FROM user WHERE email = ?"
  ).bind(email).first();

  if (!user) {
    return Response.json({ exists: false, hasPassword: false });
  }

  // Check if user has a password-based account
  const credential = await env.DB.prepare(
    "SELECT id FROM account WHERE user_id = ? AND provider_id = 'credential'"
  ).bind(user.id).first();

  return Response.json({
    exists: true,
    hasPassword: !!credential,
  });
}
```

**Route registration** in `apps/api/src/index.ts`:
```ts
if (path === "/api/check-email" && method === "POST") {
  return handleCheckEmail(request, env);
}
```

## Frontend States

The `/auth` page has three states:

### State 1: Email Entry (initial)
- Email input field
- "Continue" button
- Google OAuth button
- If invitation: email pre-filled and locked

### State 2a: Login (email exists, has password)
- Email displayed (read-only, with "Change" link)
- Password input field
- "Log in" button
- "Forgot password?" link
- Calls `signIn.email()` on submit

### State 2b: Signup (email doesn't exist)
- Email displayed (read-only, with "Change" link)
- Name input field
- Password input field
- "Create account" button
- Calls `signUp.email()` on submit

### State 2c: OAuth-only Account (exists but no password)
- Email displayed (read-only)
- Message: "You signed up with Google. Continue with Google or set a password."
- Google OAuth button
- "Set password" link (goes to forgot-password flow)

## Invitation Handling

When `?invitation=xyz` is present:

1. Fetch invitation details (existing logic)
2. Pre-fill and lock email field in State 1
3. After successful auth, redirect to `/accept-invite?invitation=xyz`

No changes to invitation acceptance logic - just routing.

## Storage Interaction

**Read operations only.** No new tables or migrations.

| Query | Table | Index Used |
|-------|-------|------------|
| Check email exists | `user` | `user_email_unique` |
| Check has password | `account` | `account_userId_idx` |

Both queries hit indexed columns. Expected latency: <5ms on D1.

## Security Considerations

### Email Enumeration

This flow reveals whether an email is registered. This is an intentional UX trade-off accepted by most consumer apps (Google, GitHub, etc.).

**Mitigations:**
1. Rate limit `/api/check-email` to 10 requests/minute per IP
2. Add `Retry-After` header when rate limited
3. Log excessive requests for monitoring

```ts
// Rate limiting with Cloudflare's built-in rate limiter
// Configure in wrangler.toml or use Workers KV for custom logic
```

### Timing Attacks

The endpoint should return in constant time regardless of whether the email exists. The D1 query time is negligible and consistent, but add a minimum response delay if needed:

```ts
const start = Date.now();
// ... query logic ...
const elapsed = Date.now() - start;
if (elapsed < 100) {
  await new Promise(r => setTimeout(r, 100 - elapsed));
}
```

## Migration Path

1. Create `/auth` route with new unified flow
2. Add `handleCheckEmail` API endpoint
3. Update redirects: `/login` and `/signup` redirect to `/auth`
4. Update all internal links to use `/auth`
5. After verification period, delete old routes

## Error Handling

| Scenario | Handling |
|----------|----------|
| Email already registered (on signup attempt) | Better Auth returns error, show "Account exists, try logging in" |
| Wrong password | Better Auth returns 401, show "Invalid password" |
| Email not verified | Better Auth returns 403, show verification prompt |
| Rate limited | Show "Too many attempts, try again in X seconds" |
| Network error | Show retry option |

## Test Plan

### Unit Tests

```ts
describe("handleCheckEmail", () => {
  it("returns exists:false for unknown email", async () => {
    const res = await handleCheckEmail(
      mockRequest({ email: "new@example.com" }),
      mockEnv
    );
    expect(await res.json()).toEqual({ exists: false, hasPassword: false });
  });

  it("returns exists:true, hasPassword:true for credential user", async () => {
    // Setup: user with password
    const res = await handleCheckEmail(
      mockRequest({ email: "existing@example.com" }),
      mockEnv
    );
    expect(await res.json()).toEqual({ exists: true, hasPassword: true });
  });

  it("returns exists:true, hasPassword:false for OAuth-only user", async () => {
    // Setup: user who signed up with Google only
    const res = await handleCheckEmail(
      mockRequest({ email: "google@example.com" }),
      mockEnv
    );
    expect(await res.json()).toEqual({ exists: true, hasPassword: false });
  });

  it("normalizes email to lowercase", async () => {
    const res = await handleCheckEmail(
      mockRequest({ email: "USER@EXAMPLE.COM" }),
      mockEnv
    );
    // Should match user@example.com in DB
  });

  it("rejects invalid email format", async () => {
    const res = await handleCheckEmail(
      mockRequest({ email: "notanemail" }),
      mockEnv
    );
    expect(res.status).toBe(400);
  });
});
```

### Integration Tests

```ts
describe("Auth Flow E2E", () => {
  it("new user: email → signup form → verify email", async () => {
    // 1. Enter email
    // 2. Verify signup form shown (name + password fields)
    // 3. Submit signup
    // 4. Verify redirect to "check your email" screen
  });

  it("existing user: email → login form → dashboard", async () => {
    // 1. Enter email
    // 2. Verify login form shown (password field only)
    // 3. Submit login
    // 4. Verify redirect to dashboard
  });

  it("OAuth-only user: email → OAuth prompt", async () => {
    // 1. Enter email of Google-only user
    // 2. Verify OAuth prompt shown
    // 3. No password field
  });

  it("invitation flow: email locked, redirects to accept", async () => {
    // 1. Visit /auth?invitation=xyz
    // 2. Verify email pre-filled and locked
    // 3. Complete signup
    // 4. Verify redirect to /accept-invite?invitation=xyz
  });
});
```

### Manual Test Checklist

- [ ] New user signup flow completes successfully
- [ ] Existing user login flow completes successfully
- [ ] Google OAuth continues to work
- [ ] "Change" email link works in step 2
- [ ] Forgot password link works
- [ ] Invitation flow pre-fills email correctly
- [ ] Error messages display correctly
- [ ] Mobile responsive layout works
- [ ] Keyboard navigation (tab order, enter to submit)

## Files Changed

| File | Change |
|------|--------|
| `apps/api/src/index.ts` | Add route for `/api/check-email` |
| `apps/api/src/handlers/auth.ts` | New file with `handleCheckEmail` |
| `apps/web/app/routes/auth.tsx` | New unified auth page |
| `apps/web/app/routes/login.tsx` | Redirect to `/auth` |
| `apps/web/app/routes/signup.tsx` | Redirect to `/auth` |
| `apps/web/app/styles/auth.module.css` | Minor tweaks for new states |

## Open Questions

1. **Should we keep `/login` and `/signup` as redirects or 404?**
   Recommendation: Redirects for backwards compatibility with bookmarks/links.

2. **Rate limiting implementation?**
   Options: Cloudflare Rate Limiting rules, Workers KV counter, or just log for now.

3. **Analytics events?**
   Track: `auth_email_checked`, `auth_signup_started`, `auth_login_started`, `auth_completed`
