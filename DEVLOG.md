# Devlog

## 2024-12-23: Production Deployment

Deployed to Cloudflare:
- `api.docketadmin.com` → Worker `docket`
- `docketadmin.com` → Worker `docket-web-production`

Key fixes:
- `vite.config.ts`: Added rollupOptions for SSR build to resolve virtual imports
- `wrangler.jsonc`: Changed main to `./build/server/index.js` (built output)
- `auth-client.ts`: Fixed env detection (process.env doesn't exist in Workers)
- `auth.ts`: Added `www.docketadmin.com` to trustedOrigins

Web deploys as Worker with Assets, not Cloudflare Pages.
