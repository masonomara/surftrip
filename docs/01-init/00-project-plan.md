# Surftrip.com

## Context

I have a take-home technical interview for Spotnana.

I want to convert one of my previous personal projects, **Docket**, into a solid take-home assessment for Spotnana. I want to model after Docket because I'm really happy with the process log and chat interface. I think the process log is a unique differentiator I want to keep.

For the take-home assessment, I will be building a surf trip planning assistant. The user talks about a destination and travel dates, and the OpenAI API stream will research the conditions, breaks, costs, and logistics through APIs and web searches — then stays in the conversation to answer follow-up questions.

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
