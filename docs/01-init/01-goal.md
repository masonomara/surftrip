# Surftrip.com

## Context

I have a take-home technical interview for Spotnana.

Read the following files:

- `docs/01-discovery/00-job-description.md`
- `docs/01-discovery/00-spotnana-bio.md`
- `docs/01-discovery/00-technical-assessment.md`

I want to convert one of my previous personal proejcts, **Docket**, into a solid take-home assessment for Spotnana. I want to model after Docket because I'm really happyw ith the process log and chat interface. I think the process log is a unique differentiator I want to keep,

For the take-home assessment, I wil be building a surf trip planning assistant. The user talks about a destination and travel dates, and the OpenAI API stream will research the conditions, breaks, costs, and logistics through APIs and web searches — then stays in the conversation to answer follow-up questions.

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

## Goal

Remove things that would be over-engineered and way out of the scope of this take-home. Scope is explicitly discussed in `docs/01-init/00-technical-assessment.md`. Adding out-of-scope complexity forces evaluators to choose between two bad reads: 1) I copied from another project without adapting it, or 2) I can't distinguish a production system from a take-home exercise.

I want to skin the current Docket project down to the bones, I dont need multitenant and multi organization architecture, I dont need cloudlfare worker AI, I dont need org contest, I dont need a clio connection. i dont need user settings, i dont need organziational management. I basically jsut need docketbot as a chatbot. When the user goes to surftrip.com, they shoudl see the surf chatbot and conversation hsitory, maybe a little profile on the bottom of the message history so they can save their chat and message hsiutroy.

Im thinking we can remove the cloudflare and instead jsut build a React Router, Supabase, Vercel project. Utilize the OpenAI API and streaming,

Down teh road, I think we will repalce the process log with teh OpenAI thinking process, and set up a ton of api calls that the open ai api can use, and websearches., but that woudl be phase two. First off and waht to focus on is strupping this project down so it can be rebuilt.

## Big Decision

Big remaining questions, do we use cloudlfare d1 and better auth for auth and message/conversation hsitroy and keep a monorepo, or flatten it, use supabase for auth and message/conversation hsitroy and deploy with vercel.
