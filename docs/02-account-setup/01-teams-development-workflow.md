# Teams Development Workflow

## Two Testing Tiers

- **Agents Playground (Local)**: Free daily dev, rapid iteration, unit tests
- **Business Basic Tenant (E2E)**: $6/mo for integration tests, real Teams environment

## Agent Playground (Local Dev)

**Setup:**

```bash
# Install via VS Code extension: "Microsoft 365 Agents Toolkit" (v5.4.0+)
# Or CLI:
npm install -g @microsoft/m365agentsplayground
```

**Dev Loop:**

Write bot code locally (Cloudflare worker handles `/api/messages`), run wrangler dev and Launch agents playground, then you can chat with bot, see adaptive cards, message handling, converation flow, bot responses, activiy handlers, etc.

Change code, restart, test again. No deploy needed.

```bash
# Terminal 1: Run your Cloudflare Worker
wrangler dev

# Terminal 2: Launch Agents Playground
agentsplayground -e "http://localhost:8787/api/messages" -c "emulator"
```

## Tier 2: Business Basic Tenant (E2E Testing)

**When to use:** Phase 10, before production release, for real E2E tests like SSO/OAuth, comnad menus, and ream teams UI

**Setup (one-time):**

1. **Buy license:** [microsoft.com/microsoft-365/business/microsoft-365-business-basic](https://www.microsoft.com/microsoft-365/business/microsoft-365-business-basic) — $6/mo

2. **Enable sideloading:**

   - Go to [admin.teams.microsoft.com](https://admin.teams.microsoft.com)
   - Teams apps → Setup policies → Global
   - Toggle "Upload custom apps" → ON
   - Teams apps → Manage apps → Actions → Org-wide settings
   - Toggle "Let users interact with custom apps" → ON
   - **Wait 24 hours** for policies to propagate

3. **Create Azure Bot:**
   - Go to [portal.azure.com](https://portal.azure.com)
   - Search for "Azure Bot" → Create
   - Pricing tier: F0 (Free)
   - Note App ID, create client secret
   - Store as Wrangler secrets:

```bash
npx wrangler secret put TEAMS_APP_ID
npx wrangler secret put TEAMS_APP_SECRET
```
