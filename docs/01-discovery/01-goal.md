# Spotnana

## Context

I have a take-home technical interview for Spotnana.

Read the following files:

- `docs/01-discovery/00-job-description.md`
- `docs/01-discovery/00-spotnana-bio.md`
- `docs/01-discovery/00-technical-assessment.md`

I want to convert one of my previous personal proejcts, **Docket**, into a solid take-home assessment for Spotnana. For the take-home assessment, I wil be building a surf trip planning assistant. The user drops in a destination and travel dates, and the agent researches the conditions, breaks, costs, and logistics — then stays in the conversation to answer follow-up questions.

The core intelligence will mirror Docket's tool-calling loop: the LLM decides when it needs real data, calls the appropriate tool, gets live results, and synthesizes a real answer. Instead of Clio, the tools are marine forecast APIs, and will only be doing read commands.

## Project Plan

Based on the spec and preceding interview questions, this is what the project should be:

A frontend app collects user input, sends it to a server via an API call, and the server forwards it to an AI model. The model returns a response, the server passes it back, and the frontend renders it on the page. Don't call the AI API directly from the browser — keep your API keys on the server and let the server handle the AI call. The frontend just sends and receives.

Users must be informed that the system is processing their request. Show a loading indicator — a spinner, animated dots, or a typing bubble — when the request is sent, and hide it when the response arrives. The best pattern in production: optimistic message display combined with a streaming response. The user sees their message appear immediately, then watches the reply generate in real time.

If a user clicks a button several times quickly and triggers multiple AI requests, disable the button UI and use async/await to pause concurrent requests by tracking the state of the first one. Example:

```js
let isLoading = false

async function sendMessage(input) {
  if (isLoading) return
  isLoading = true
  const res = await fetch('/api/chat', { method: 'POST', body: ... })
  const data = await res.json()
  display(data.reply)
  isLoading = false
}
```

Here is a short example of code when receiving a JSON response from an AI API that contains generated text:

```js
const res = await fetch('/api/chat', { method: 'POST', body: ... })
const data = await res.json()

document.getElementById('output').textContent = data.reply
```

The request should be wrapped in a try/catch. If it fails, display an error message to the user and re-enable the input so they can try again.

Before sending a user's prompt to an AI service, check that the input isn't empty or too long — if either is true, the send button on the client-side could be disabled. Token limits are real and AI APIs will error or truncate if you exceed them. Catching that on the frontend is cheaper than letting it hit the server.

The assessment explicitly names OpenAI or HuggingFace. Use OpenAI — specifically `gpt-4o-mini` (cheap, fast, good enough to make the UI shine).

Do not replicate Docket's AI infrastructure (Workers AI, RAG pipeline, BGE embeddings, Vectorize). This is a frontend role. The AI is a prop. The grader is evaluating React, component structure, state management, and UI polish — not LLM routing decisions. Showing custom model infrastructure signals the wrong thing: that time was spent on backend complexity instead of UI craft, or that the submission was lifted from a production project without adapting it.

The one place to invest AI effort is the system prompt. A well-crafted travel-focused system prompt produces responses good enough to make the demo feel real — and that's a frontend-visible skill. Response streaming via the OpenAI streaming API is also worth implementing: it's a visible UX upgrade that demonstrates production-mindedness without adding backend complexity.

Where to put energy instead: response streaming via the OpenAI streaming API is a visible UX upgrade that demonstrates production-mindedness. A clean message list component shows component architecture. Thoughtful error states show production thinking. A good system prompt tuned for travel makes the demo feel real. A responsive, polished UI is what they are actually grading.

## Goal

Remove things that would be over-engineered and way out of the scope of this take-home. Adding out-of-scope complexity forces evaluators to choose between two bad reads: 1) I copied from another project without adapting it, or 2) I can't distinguish a production system from a take-home exercise.
