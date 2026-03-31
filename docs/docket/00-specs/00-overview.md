# Docket - Overview

A case management bot for law firms and legal clinics using Clio. Docket helps legal teams work faster with Clio and use their case information safely with AI and a customized knowledge base.

## Team

- Mason, Technical Lead
- **TODO:** Need an industry expert with legal practice expertise

## How It Works

Users chat via web interface, Microsoft Teams, MCP clients, Slack, or other channels. The bot accesses:

- **Knowledge Base (KB)** — Case management documentation shared across all organizations (D1 + Vectorize). Built with a legal expert.
- **Org Context** — Organization-specific documentation: operating procedures, structure. Uploaded by Admins. Per-org isolated (D1 + Vectorize filtered by org_id, raw docs in R2).
- **Clio Schema** — Clio schema, best practices, safety measures, Clio API documentation. Cached per-org (DO SQLite, loaded to memory).
- **Clio Interaction** — Bot executes Clio API commands via tools.

## Product Flow

1. User sends chat message
2. Chatbot forwards to Cloudflare Worker
3. Worker routes message and client instance to Durable Object (DO)
4. DO uses RAG to pull relevant chunks from KB and Org Context
5. DO injects RAG information into LLM prompt
6. LLM accesses KB, Org Context, Clio Schema, and Clio account (OAuth)
7. LLM processes and responds
8. If user needs Clio access: LLM writes Clio API call → DO executes → results return to LLM → response sent
9. Server validates with user before any Create, Update, or Delete operation (if user has permissions)

## User Roles and Permissions

**User Roles:**

- **Admin** — Full org management: edit Org Context, change org settings, assign roles, invite new members. CUD operations via Docket Bot.
- **Member** — Read-only Clio queries. Cannot invite, edit settings, or manage Org Context (but bot uses it for them).
- **Owner** — One Admin is marked as Owner (`is_owner: true`). The org creator becomes Owner by default. Owner cannot be demoted or removed. Owner can transfer ownership to another Admin (requires password re-entry).

**Clio Permissions:**

- All users can query Clio data (Read operations execute automatically)
- Only Admins can create, update, or delete Clio records
- All Create/Update/Delete actions require explicit user confirmation

**Docket Bot Permissions:**

All conversations access the KB and Org Context regardless of role. Role restrictions apply only to editing Org Context via docket.com settings.

## Progress So Far

Mason built an MVP Salesforce Fundraising Bot. Users downloaded the app in Slack, signed into Salesforce via Slack, and messaged the bot. The bot accessed the KB, Org Context, and communicated with Salesforce. Strengths: speed and accuracy of LLM responses, service integration (Slack, Bot, Salesforce), validation on Clio API patterns.

Clio and Salesforce share similar user pain points and API structure. Mason has familiarity with legal practices.

**What MVP Validated:**

- Running software through existing chat apps as primary interface (Teams, Slack)
- High-level architecture: Channel Adapters, Cloudflare Workers, Vector Database effectiveness, RAG effectiveness, D1 querying, DOs for state and logic

**How We're Applying What We Learned:**

Using structured parameters for Clio API calls and funneling through one tool rather than creating multiple tools. This addresses LLM non-determinism and unreliability when writing untethered commands.
