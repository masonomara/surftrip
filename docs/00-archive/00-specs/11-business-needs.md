# Business Needs

## Pricing Model

- Sign up as Admin or Member
- Org pricing tied to organization
- Org member permissions based on org settings
- User profiles are lightweight
- Account based on email address
- Every organization has an Admin who can change org type
- Org pricing like Shopify: different tiers allow different amounts of Admins and read-only Members
- MCP/ChatGPT is free trial, Teams is enterprise only
- More features to come

## Safety of Information

- Data classified as PRIVILEGED, CONFIDENTIAL, INTERNAL, or PUBLIC.
- No AI training on data (Anthropic, OpenAI API guarantees)
- Tenant isolation: DO SQLite for conversations, org_id filtering for context, R2 path isolation
- Clio OAuth tokens encrypted in DO Storage (per-user, per-org)
- Cloudflare: encrypted in transit/at rest, SOC 2 Type II, DDoS protection
- Data stored US-EAST only
- Data portability and deletion rights
- Clio writes, Org Context changes, permission changes logged

## Before Production

1. Legal counsel review of professional responsibility compliance
2. Information security audit (preferably SOC 2)
3. Data Processing Agreement with Cloudflare
4. Comprehensive encryption implementation
5. Multi-year audit log retention
6. Conflict of interest detection mechanism
7. Disaster recovery and backup procedures

## Compliance & Legal Gaps

**No Data Retention Policy:**

- Legal ethics rules require specific retention periods for client files
- How long are conversations stored? Who decides deletion? What happens during litigation holds?

**No Breach Notification Procedure:**

- When Clio tokens compromised, Org Context leaks, or conversations exposed—who notifies? Within what timeframe? Which jurisdictions' laws apply?

**No Attorney-Client Privilege Protection:**

- System stores legal conversations but has no mechanism to:
  - Mark communications as privileged
  - Control access for opposing counsel scenarios
  - Prevent inadvertent disclosure
  - Generate privilege logs for discovery

**No Conflict of Interest Detection:**

- Two users from opposing parties could use Docket at different firms
- No mechanism to detect or prevent conflicts

**GDPR Compliance Missing:**

- No data portability mechanism (Article 20)
- No right to erasure implementation (Article 17)—how are Vectorize embeddings removed? R2 archives? Audit logs?
- No data processing agreement with Cloudflare mentioned
- No consent tracking mechanism

**No BAA Framework:**

- If handling healthcare-adjacent legal matters (PI, medical malpractice), HIPAA may apply
- No Business Associate Agreement framework mentioned

**Cross-Border Data Transfer:**

- No mention of data residency requirements
- Cloudflare has global infrastructure—where is data actually stored?

**No Unauthorized Practice of Law Safeguards:**

- `08-workers-ai.md:85` says "NEVER give legal advice" in prompt
- No technical enforcement—could hallucinate legal advice
- No citation verification for RAG sources

## Microsoft Teams App Requirements:

- App must link to live SaaS offer on AppSource with pricing
- Manifest includes `subscriptionOffer` in `publisherId.offerId` format
- Valid app package: zip with manifest and icons
- Custom apps uploadable for testing without formal review
- Microsoft Teams Partner Center account required
- Source: [Teams App Publishing](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/appsource/publish)
