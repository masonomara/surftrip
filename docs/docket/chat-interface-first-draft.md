# Chat Interface (Phase 9b)

**Current Status**: We have an amazing API and Web app set up. Everything is configured and prepared to start implementing Message Channels. Our current specs are prepared to take on Microsoft Teams as our first channel

## Proposition

I want to focus on a chat interface for the web app. This is better for user feedback:

- Quicker hook - Users dont need to create a Docket account then configure with Teams, they make a Docket account and then can start chatting right away
- Better showcase - We can show the steps DocketBot is taking to deliver the answer (API -> Durable Object -> Knowledge Base -> Org Context -> Clio Commands)
- Internal visibility: We can chat with DocketBot and see the process ourselves in an easy interface to make improvements.

## What We Need

Chat interface page:

- When a user has an orginazation, the "dashboard" page is replaced with the "Docketbot" page
- In the page, there are three columns: left column is all previous chats and a new chat button. Right column "streams" logs of the process (think cards with "Step 4: Vector Lookup" with previews of relevant chunks of text and other cool under the hood things). The middle column is the chat interface
- Just keep consistent with the styles we already have, avoid new styles.

Marketing page:

- Style notes: Think vintage nike ad or car ad, offwhite backgorund, big text, dont be afraid to use script or Apple Garmind type font, the brand can be different then the product.
- Low priority, don't spend more than an hour on this.
- Just text, image/gif/video of the product, and a "Log in" button up top

Storage strategy:

- How much does this deviate from Microsoft teams? (percentage %?). Validate we have conversations, messages, confirmation states (for Clio commands), anythign else we would possibly need.
- GO through the numbered docs for any notes on storage for the web chat interface or anythign that would be helpful.
- Note: This is essential to get down before we begin.

API Endpoints/Channel Adapter:

- Similar to storage strategy, go through numbered docs on processing web UI messages and anything that would be helpful.
- Note: Plan out a bit more before we begin.

_Add more when necesary as we disocver more_

## Gaps

Clio API Integration - Is this even working? We should run some more quick smoke tests and explore what the manual end-to-end feels like.

## What We Have

`05-channel-adapter.md` defines "web" as a valid channel in `ChannelMessage`. Is this implemented in the code at all?
