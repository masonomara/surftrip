# Chat Interface (Phase 9b)

## Overview

Web chat interface for DocketBot. Users with an organization see the chat page instead of the dashboard. Architecture uses Server-Sent Events (SSE) for streaming responses with process visibility.

**Key decision:** The `"web"` channel type already exists in `ChannelMessage`. Storage (conversations, messages, pending_confirmations) already exists in DO SQLite. This phase adds the API endpoint and frontend.

## Storage Analysis

**Deviation from Teams:** ~5%. The existing DO SQLite schema handles web chat without modification.

| Requirement       | Teams                        | Web                        | Storage Location                  | Status         |
| ----------------- | ---------------------------- | -------------------------- | --------------------------------- | -------------- |
| Conversations     | `conversation.id` from Teams | UUID generated client-side | DO SQLite `conversations`         | Exists         |
| Messages          | Per conversation             | Per conversation           | DO SQLite `messages`              | Exists         |
| Confirmations     | Per conversation             | Per conversation           | DO SQLite `pending_confirmations` | Exists         |
| Conversation list | N/A (Teams manages)          | Query by org               | DO SQLite                         | Needs endpoint |

**New requirement:** Endpoint to list conversations for left sidebar. Currently no `GET /conversations` exists.

## API Design

### New Endpoints

**1. Chat message endpoint (SSE streaming)**

```text
POST /api/chat
Content-Type: application/json
Accept: text/event-stream

Body: {
  conversationId: string,  // UUID, client-generated for new chats
  message: string
}
```

Response: SSE stream with events:

```text
event: step
data: {"type": "rag_lookup", "chunks": [...]}

event: step
data: {"type": "llm_thinking", "content": "Analyzing your question..."}

event: step
data: {"type": "clio_call", "operation": "read", "objectType": "Matter"}

event: message
data: {"content": "Here are your open matters...", "done": true}
```

**2. Conversation list endpoint**

```text
GET /api/conversations
Response: {
  conversations: [
    { id: string, title: string, updatedAt: number, messageCount: number }
  ]
}
```

**3. Conversation history endpoint**

```text
GET /api/conversations/:conversationId
Response: {
  conversation: { id, createdAt, updatedAt },
  messages: [{ id, role, content, createdAt }]
}
```

**4. Delete conversation endpoint**

```text
DELETE /api/conversations/:conversationId
Response: { success: true }
```

### Authentication

All endpoints use existing Better Auth session (cookie-based). The session middleware (`withMember`) provides `userId`, `orgId`, `role`.

### Clio Not Connected Handling

If user attempts Clio operation without connection, return in SSE stream:

```
event: error
data: {"type": "clio_not_connected", "redirectUrl": "/org/clio"}
```

Frontend displays: "Connect your Clio account to use this feature" with link.

## Implementation Checklist

### API Work (`apps/api/`)

- [ ] Create `src/handlers/chat.ts` with:
  - [ ] `handleChatMessage` - SSE streaming endpoint
  - [ ] `handleGetConversations` - List user's conversations
  - [ ] `handleGetConversation` - Get single conversation with messages
  - [ ] `handleDeleteConversation` - Delete a conversation

- [ ] Update `src/do/tenant.ts`:
  - [ ] Add `GET /conversations` endpoint (list by updatedAt desc, limit 50)
  - [ ] Add `GET /conversation/:id` endpoint (conversation + messages)
  - [ ] Add `DELETE /conversation/:id` endpoint
  - [ ] Modify `handleProcessMessage` to yield SSE events instead of single response
  - [ ] Add step events: `rag_lookup`, `llm_thinking`, `clio_call`, `clio_result`

- [ ] Update `src/index.ts`:
  - [ ] Add routes: `POST /api/chat`, `GET /api/conversations`, `GET /api/conversations/:id`, `DELETE /api/conversations/:id`
  - [ ] Use `withMember` middleware for all chat endpoints

- [ ] Add `conversationScope: "personal"` for all web channel messages (1:1 chat)

### Web Work (`apps/web/`)

- [ ] Create `app/routes/chat.tsx` - Main chat interface (replaces dashboard for orgs)
- [ ] Create `app/routes/chat.$conversationId.tsx` - Specific conversation view
- [ ] Update `app/routes/dashboard.tsx` - Redirect to `/chat` if user has org

**Chat page layout (three columns):**

```
+------------------+------------------------+------------------+
| Conversations    | Chat                   | Process Log      |
| [New Chat]       |                        |                  |
| - Conv 1         | [Messages scroll]      | Step 1: RAG      |
| - Conv 2         |                        | Step 2: LLM      |
| - Conv 3         | [Input box]            | Step 3: Clio     |
+------------------+------------------------+------------------+
```

- [ ] Create `app/components/ChatSidebar.tsx` - Left column, conversation list
- [ ] Create `app/components/ChatMessages.tsx` - Middle column, message display
- [ ] Create `app/components/ChatInput.tsx` - Message input with submit
- [ ] Create `app/components/ProcessLog.tsx` - Right column, step visibility
- [ ] Create `app/lib/use-chat.ts` - Hook for SSE connection and state management

**SSE client pattern:**

```typescript
// app/lib/use-chat.ts
export function useChat(conversationId: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  async function sendMessage(content: string) {
    setIsStreaming(true);
    setSteps([]);

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ conversationId, message: content }),
    });

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    // Parse SSE events
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value);
      // Parse event: and data: lines, update state
    }

    setIsStreaming(false);
  }

  return { messages, steps, isStreaming, sendMessage };
}
```

### Conversation ID Generation

Client generates UUID for new conversations:

```typescript
const newConversationId = crypto.randomUUID();
navigate(`/chat/${newConversationId}`);
```

First message to a new `conversationId` creates the conversation record in DO SQLite (existing behavior in `ensureConversationExists`).

### Process Log Steps

Display these step types with appropriate UI:

| Step Type               | Display                       | Data                                  |
| ----------------------- | ----------------------------- | ------------------------------------- |
| `rag_lookup`            | "Searching knowledge base..." | `{ chunks: [{ text, source }] }`      |
| `llm_thinking`          | "Analyzing..."                | `{ content: string }`                 |
| `clio_call`             | "Querying Clio..."            | `{ operation, objectType, filters? }` |
| `clio_result`           | "Found X records"             | `{ count, preview }`                  |
| `confirmation_required` | "Confirm action"              | `{ action, objectType, params }`      |

### Styling

Use existing CSS classes. No new design system components. Reference `apps/web/app/styles/` for patterns.

## Testing

- [ ] Unit test: `handleChatMessage` SSE format
- [ ] Unit test: Conversation CRUD operations
- [ ] Integration test: Full message flow with mocked AI
- [ ] Manual test: Multi-tab behavior (each tab can have different conversation)

## Files to Create/Modify

**Create:**

- `apps/api/src/handlers/chat.ts`
- `apps/web/app/routes/chat.tsx`
- `apps/web/app/routes/chat.$conversationId.tsx`
- `apps/web/app/components/ChatSidebar.tsx`
- `apps/web/app/components/ChatMessages.tsx`
- `apps/web/app/components/ChatInput.tsx`
- `apps/web/app/components/ProcessLog.tsx`
- `apps/web/app/lib/use-chat.ts`

**Modify:**

- `apps/api/src/index.ts` - Add routes
- `apps/api/src/do/tenant.ts` - Add endpoints, modify process-message for SSE
- `apps/web/app/routes/dashboard.tsx` - Redirect to chat if org exists
