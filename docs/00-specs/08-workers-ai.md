# Docket Workers AI

## Model Selection

Text generation: `@cf/meta/llama-3.1-8b-instruct`. Embeddings: `@cf/baai/bge-base-en-v1.5`.

## Context Window Management

128K tokens available:

- System prompt base: ~500 for instructions, character
- Clio Schema: ~1,500 for compressed core objects
- Knowledge Base (KB) context: ~1,500 from Vectorize
- Org Context: ~1,500 from Vectorize filtered by `org_id`
- Conversation history: ~3,000 capped at last 15 messages (per `conversationId`)
- Response Buffer: ~2,000 for max response length
- TOTAL: ~10,000 (well under 128K)

## Function Calling (Tool Use)

We use a single `clioQuery` tool. The LLM picks operations and actions; the DO builds validated Clio API calls, enforces permissions, and executes. This prevents injection attacks and malformed queries.

**Request Flow:**

1. User message received by Channel Adapter
2. Build context: Shared KB, Org Context, Clio Schema
   - `this.retrieveKBContext(message)`, `this.retrieveOrgContext(message, msg.orgId)`
   - Schema provides LLM with Clio object structure. Fetched once per org at provisioning, not runtime.
3. Call LLM with tools
   - No tool call → return text directly
4. LLM responds (text or tool_call)
5. If tool_call: DO checks user permissions. If read: execute immediately. If CUD: store as pending, ask user permission
6. Execute Clio API
7. Feed result back to LLM
8. Return synthesized response

**CUD Confirmation Flow:**

CUD operations store a pending confirmation and ask user to approve. After the pending confirmation is stored, the function builds a human-readable description of the operation.
**Confirmation Detection & Handling:**

When a pending confirmation exists for the user, the next message is classified by the LLM before normal processing. Pending confirmations expire after 5 minutes. Expired ops are cleared on next message.

LLM includes the pending operation in context, and asks for intent classification:

- `approve` (User confirms, "yes", "do it", "looks good") - Execute pending op, clear it, return result
- `reject` (User declines, "no", "cancel", "nevermind") - Clear pending op, acknowledge cancellation
- `modify` (User wants changes, "yes but change the date", "make it 5pm instead") - Clear pending op, process as new CUD request with modifications
- `unrelated` (New topic, ignores pending op): Keep pending op, process message normally (op expires per `expires_at`)

Structured params generate a REST call that maps an object to the Clio endpoint. It builds the request based on the operation. After Clio execution, the result is fed back to LLM for natural language response.

**Error Handling in Tool Execution:**

LLM receives error message in tool response and explains to user naturally. Example responses:

- 401: "Your Clio connection has expired. Please reconnect at docket.com/settings."
- 403: "You don't have permission to access this in Clio."
- 404: "That record wasn't found in Clio."
- 422: "Clio rejected the request—some required fields may be missing."
- 429: "Clio rate limit hit. Please wait a moment and try again."
- 500: "Clio is having issues right now. Please try again shortly."

## System Prompt Construction

Built from four sources in DO:

1. `retrieveKBContext(query)` — Vectorize → Shared KB
2. `retrieveOrgContext(query, orgId)` — Vectorize with org filter → Org Context (firm-specific docs)
3. `this.schemaCache` — Memory (from SQLite) → Clio object definitions
4. `getRecentMessages(conversationId)` — SQLite → history for this conversation only

**Example:**

```typescript
const systemPrompt = `You are Docket, a case management assistant for legal teams using Clio.

**Tone:** Helpful, competent, deferential. You assist—you don't lead.

**Knowledge Base Context:**
${formattedKBContext}

**Org Context (This Firm's Practices):**
${formattedOrgContext}

**Clio Schema Reference:**
${clioSchemaReference}

**Instructions:**
- Use Knowledge Base and Org Context for case management questions
- Query Clio using the clioQuery tool per the schema above
- For write operations (create, update, delete), always confirm first
- NEVER give legal advice—you manage cases, not law
- Stay in scope: case management, Clio operations, firm procedures`;
```

**Clio Schema Storage:**

DO constructor loads memory cache via `blockConcurrencyWhile()`, injects into prompt as condensed reference.

**Error codes and strategies:**

- 3040 (429 error): Capacity exceeded, retry once after 1s delay
- 3043 (500 error): Internal server error, retry once after 1s delay
- 3007 (408 error): Timeout, retry with smaller output
- 3036 (429 error): daily limit reached, fail and notify user
- 5007 (400 error): Model not found, fail and log error

**Graceful degradation:** RAG failures return empty context; AI continues without KB.
