# Docket Clio Integration

## Clio Development

To build with the Clio API, you need a Clio account. Then create a Clio developer application from the developer portal.

## Clio API

Base URL: `https://app.clio.com/api/v4/`

**Core objects** (read/write via tools):

- Matters - cases/files
- Contacts - clients, opposing parties, witnesses
- Tasks - todos, deadlines
- Calendar Entries - appointments, court dates
- Time Entries - billable time
- Documents - file metadata (content via separate endpoint)

**Read-only objects** (reference data):

- Practice Areas
- Activity Descriptions
- Users (firm staff)

## Clio Schema Caching

A per-org Clio Schema is cached in DO SQLite. Fetch handles custom fields added by firm admins, and Clio API changes. Fetch is triggered by:

- First Clio API call (no cached schema)
- User triggers refresh via docket.com/settings
- Developer schema updates

## Clio API Schema

Each object type has a schema endpoint:

```
GET /api/v4/matters.json?fields=schema
GET /api/v4/contacts.json?fields=schema
GET /api/v4/tasks.json?fields=schema
...
```

Response includes field definitions:

```json
{
  "schema": {
    "type": "Matter",
    "fields": [
      { "name": "id", "type": "integer", "read_only": true },
      { "name": "display_number", "type": "string", "required": true },
      { "name": "description", "type": "string" },
      {
        "name": "status",
        "type": "string",
        "enum": ["Open", "Pending", "Closed"]
      },
      { "name": "client", "type": "Contact", "relationship": true },
      { "name": "practice_area", "type": "PracticeArea", "relationship": true },
      { "name": "open_date", "type": "date" },
      { "name": "close_date", "type": "date" }
    ]
  }
}
```

## Clio OAuth

Per-user tokens stored encrypted in DO Storage (AES-GCM). Access tokens expire after 7 days; refresh tokens don't expire but can be revoked. For security: PKCE required (S256), state signed with HMAC-SHA256 (10-min expiry).

## Clio Multi-Tenant Architecture

Clio's OAuth model supports multi-tenant applications. Each user authorizes Docket independently via OAuth, so each authorization creates a distinct `access_token` for that user. Tokens are per-user, not per-firm. Docket stores tokens in DO Storage keyed by `user_id`. Rate limits apply per access token, so heavy usage by one firm doesn't affect others. Each org's DO stores its users' Clio tokens in DO Storage (encrypted AES-GCM). Cross-org token access is architecturally impossible—DOs are isolated by `org_id`

## Clio Error Handling

**HTTP error codes and responses:**

- 400 (Bad Request): "The request was invalid. Please try rephrasing.", log, don't retry
- 401 (Unauthorized): "Your Clio connection expired. Please reconnect at docket.com/settings.", attempt token refresh; if fails, mark `clio_connected=false`
- 403 (Forbidden): "You don't have permission to access this in Clio.", log, don't retry
- 404 (Not Found): "That record wasn't found in Clio.", don't retry
- 410 (Gone): "This API version is no longer supported.", alert ops, critical error
- 422 (Unprocessable): "Clio rejected the request—some fields may be missing or invalid.", don't retry
- 429 (Rate Limited): "Clio is busy. Please wait a moment and try again.", wait `Retry-After` seconds
- 500+ (Server Error): "Clio is having issues. Please try again shortly.", retry once after 2s

**API Rate Limits:**

50 requests/minute per access token on peak hours is no cause for concern
