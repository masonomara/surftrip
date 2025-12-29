# Chat Interface (Phase 9b)

## Overview

We need to build a chat interface for Docketbot. We were prepared to buidl the Micossoft Teams chat channel first, but now we are doing the "web channel" first on the web app.

The "web" channel type already exists in 'ChannelMessage' storage (conversations, messages, pending_conversations) already exists in SQLite. We need to add the API endpoint and frontend.

## Storage Strategy

Conversations:

- UUID generated client-side
- Use DO SQLite `conversations`
- Teams equivalent: `conversation.id`

Messages:

- Per conversation
- Use DO SQLite `messages`

Confirmations:

- Per conversation
- Use DO SQLite `pending_confirmations`

Conversation List:

- Query by user, only query "web" conversations
- Need to build `GET /conversations` endpoint
- Not applicable to Teams, they manage

## Frontend Wireframe

Chat page layout (three columns):

```text
+------------------+------------------------+------------------+
| Conversations    | Chat                   | Process Log      |
| [New Chat]       |                        |                  |
| - Conv 1         | [Messages scroll]      | Step 1: RAG      |
| - Conv 2         |                        | Step 2: LLM      |
| - Conv 3         | [Input box]            | Step 3: Clio     |
+------------------+------------------------+------------------+
```

On Styling:

- Use existing CSS classes as much as possible.
- No needless design system components.

On Conversations:

- Client generates UUID for new conversations (`const newConversationId = crypto.randomUUID(); navigate(`/chat/${newConversationId}`);`).
- First message to a new `conversationId` creates the conversation record in DO SQLite (existing behaivior `ensureConversationExsits`)

On Process Log:

- "Under-the-hood stream of conciousness"
- Example steps:
  - `rag_lookup` - `{ chunks: [{ text, source }] }`
  - `llm_thinking` - `{ content: string }`
  - `clio_call` - `{ operation, objectType, filters? }`
  - `clio_result` - `{ count, preview }`
  - `confirmation_required` - `{ action, objectType, params }`

On Chat:

- "ChatGPT"
- Consider confirmations on Clio actions

## API Design

Chat message endpoint (SSE streaming):

- POST `/api/chat`
- conversationId: string (UUD, client-generated for new chats)
- message: string

Chat message response (SSE stream with events):

- content: "here are your open matters..."

Process log steps example responses (SSE stream with events):

- type: "rag_lookup" | "llm_thinking" | "clio_call"
- chunks: [...]
- content: "Analyzing your question..."
- operation: "read"
- objectType: "Matter"

Conversation list endpoint:

- GET `api/conversations`
- conversations: { id: string, title: string, updatedAt: number, messageCount: number }

Conversation history endpoint:

- GET `/api/conversations/:conversationId`
- conversation: {id, createdAt, updatedAt}
- messages: [{ id, role, content, createdAt }]

Delete conversation endpoint:

- DELETE `api/conversations/:conversationId`
- Response: { success: true }

_need to add confirmatuions/clio actions considerations_

## Authenticaion

All endpoints can use existong Better Auth session middleware which provides `userId`, `orgId`, and `role`.

## Testing

- [ ] Unit test: `handleChatMessage` SSE format
- [ ] Unit test: Conversation CRUD operations
- [ ] Integration test: Full message flow with mocked AI
- [ ] Manual test: Multi-tab behavior (each tab can have different conversation)

## Dev Plan

Web:

- [ ] Create `app/routes/chat.tsx` - Main chat interface (replaces dashboard for orgs)
- [ ] Create `app/routes/chat.$conversationId.tsx` - Specific conversation view
- [ ] Update `app/routes/dashboard.tsx` - Redirect to `/chat` if user has org
- [ ] Create `app/components/ChatSidebar.tsx` - Left column, conversation list
- [ ] Create `app/components/ChatMessages.tsx` - Middle column, message display
- [ ] Create `app/components/ChatInput.tsx` - Message input with submit
- [ ] Create `app/components/ProcessLog.tsx` - Right column, step visibility
- [ ] Create `app/lib/use-chat.ts` - Hook for SSE connection and state management
