# Docket User Flows

## Creating an Account

**Sign up via Docket website:**

1. Sign up at Docket website
2. Create a user profile (low friction)
3. After signup: option to create an organization, or message that you must be invited to see an organization dashboard. See `docs/mockups/mockup-1.png`
4. If already part of an organization, go directly to org details (see Anthropic's Claude Settings for reference)

**Sign up via invitation:**

1. Admin sends invite from Docket website (email added to org's allowed emails with assigned role)
2. NOTE: If user's email already belongs to another Docket account, Admin sees an error. User must leave their current org before receiving a new invitation.
3. New user clicks email link
4. User sees "sign in or create account" page
5. User signs in or creates account
6. Redirected to invited organization

**Log in via Teams:**

1. User installs Docket app from Teams App Store
2. User messages bot for the first time
3. Bot displays "Sign in with Microsoft" card
4. User clicks → Microsoft SSO popup → user approves
5. If email matches Docket account: "Welcome back! You're connected."
6. If no match: "No Docket account found for {email}. Sign up at docket.com/signup"
7. Once linked, user can message normally

**Log in via Slack:**

1. User adds Docket app to Slack workspace (admin approval may be required)
2. User messages bot for the first time
3. Bot replies: "Link your Docket account: docket.com/link?code=ABC123"
4. User clicks link → logs into Docket website → accounts linked
5. Bot confirms: "You're connected! How can I help?"
6. If user doesn't have Docket account: signup flow on website first

**Joining a Law Org:**

1. After signup, pending invitations change `docs/mockups/mockup-1.png` to `docs/mockups/mockup-2.png`
2. Accept to join the organization
3. After joining, always route directly to organization dashboard

## Creating a Law Org

1. Without an org, create one from `docs/mockups/mockup-1.png`
2. Brief onboarding flow: org type (clinic, firm), practice areas, location, name, logo
3. Creator becomes Owner (Admin with `is_owner: true`)

## Connecting to Clio

Each user connects their own Clio credentials via Docket Website settings.

## Inviting Members

Users without a matching invitation cannot join. Users join via invitation only:

1. Admin invites by email via docket.com
2. Invitation stored in D1 `invitations` table
3. User signs up/logs in with that email
4. System checks D1 for matching pending invitation
5. User record created in D1 (via Better Auth), linked to org
6. Invitation marked accepted

**Ownership Transfer:**

1. Owner initiates transfer via org settings (selects target Admin)
2. System requires Owner to enter password
3. Transfer is completed

## Managing Legal Practice Settings

1. Only Admins can manage settings on docket.com
2. Docket Bot redirects settings requests to the website (e.g., "Hey docket, upgrade my plan" → link to docket.com)
3. Settings include uploading company documentation

## Managing Org Context

1. Admins create/read/update/delete Org Context via docket.com
2. Raw docs stored in R2 (`/orgs/{org_id}/docs/`), chunks in D1, embeddings in Vectorize (filtered by org_id).
3. LLM considers Org Context in responses

## Interacting with Clio

**User asks "What cases are due this week":**

1. Docket Bot accepts message and user UUID
2. Bot sends message to Channel Adapter
3. Channel Adapter passes user_id and message to Durable Object
4. DO looks up user role, enforces permissions before LLM receives direction
5. If Admin:
   - Can Update/Create/Delete records in Clio
   - LLM uses RAG for Knowledge Base (KB), Clio Schema, and Org Context
   - LLM can write Clio API call to retrieve Clio data
   - For Create/Update/Delete: LLM generates confirmation message (e.g., "Docket wants to {action}. Accept?"), DO enforces gate that won't execute without user approval
   - YES: Docket executes Clio API call
   - NO: Docket sends message back
   - LLM incorporates Clio data with existing knowledge
6. If Member (read-only):
   - Cannot Update/Create/Delete in Clio
   - LLM uses RAG for KB, Clio Schema, and Org Context
   - LLM writes read-only Clio API queries
   - LLM incorporates Clio data with existing knowledge
