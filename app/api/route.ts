import { openai } from "@ai-sdk/openai";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  convertToModelMessages,
  streamText,
  isTextUIPart,
} from "ai";
import type { UIMessage } from "ai";
import { createClient } from "@/lib/supabase/server";

// ── System prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Surftrip, an expert surf travel planning assistant.

You help surfers plan trips by researching destinations, surf breaks, swell conditions, travel logistics, and costs. You have deep knowledge of surf spots worldwide — wave quality, optimal seasons, crowd levels, ideal skill levels, and what to expect in the water.

When a user describes a destination and travel dates:
1. Assess the surf conditions and swell season for that window
2. Identify the best breaks for their skill level
3. Outline travel logistics (flights, transfers, accommodation options)
4. Give a realistic budget estimate

Be specific and practical. Surfers want actionable information, not vague travel writing. Stay in the conversation to answer follow-up questions.`;

// ── Constants ──────────────────────────────────────────────────────────────

// Must match MAX_LENGTH in ChatInput.tsx.
const MAX_INPUT_LENGTH = 10_000;

// ── Route handler ──────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { messages, chatId }: { messages: UIMessage[]; chatId: string } =
    await req.json();

  // Extract the plain text content of the last message. The AI SDK represents
  // message content as an array of typed parts; we need the raw string to
  // validate it and later persist it to the DB.
  const lastMessage = messages.at(-1);
  const userContent =
    lastMessage?.parts
      .filter(isTextUIPart)
      .map((part) => part.text)
      .join("") ?? "";

  if (!userContent.trim()) {
    return new Response("Empty message", { status: 400 });
  }

  if (userContent.length > MAX_INPUT_LENGTH) {
    return new Response("Message too long", { status: 400 });
  }

  // For authenticated users, verify the conversation belongs to them before
  // proceeding. RLS would block the DB write anyway, but this gives a cleaner
  // 403 response instead of a silent empty result.
  if (user) {
    const { data: conversation } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", chatId)
      .single();

    if (!conversation) {
      return new Response("Conversation not found", { status: 403 });
    }
  }

  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: async ({ writer }) => {
        const result = streamText({
          model: openai("gpt-4o"),
          system: SYSTEM_PROMPT,
          messages: await convertToModelMessages(messages),

          // onFinish is async — errors here are non-fatal to the stream but
          // must be caught so they don't silently swallow the DB write failure.
          onFinish: async ({ response }) => {
            if (!user) return;

            // Extract the assistant's reply as a plain string. The model
            // response content can be either an array of parts or a raw string
            // depending on the model and response type.
            const assistantMessage = response.messages.at(-1);
            let assistantContent = "";

            if (assistantMessage) {
              if (Array.isArray(assistantMessage.content)) {
                assistantContent = assistantMessage.content
                  .filter(
                    (part): part is { type: "text"; text: string } =>
                      part.type === "text",
                  )
                  .map((part) => part.text)
                  .join("");
              } else {
                assistantContent = String(assistantMessage.content);
              }
            }

            try {
              // Persist both the user message and the assistant reply together
              // so they're always saved as a matched pair.
              await supabase.from("messages").insert([
                { conversation_id: chatId, role: "user", content: userContent },
                {
                  conversation_id: chatId,
                  role: "assistant",
                  content: assistantContent,
                },
              ]);

              // Set the conversation title from the first user message, but
              // only if the title is still the default "New conversation".
              // This avoids overwriting a title that was set by a previous exchange.
              const isFirstMessage = messages.length === 1;
              if (isFirstMessage) {
                const truncated = userContent.slice(0, 60).trim();
                const title =
                  truncated.length < userContent.trim().length
                    ? `${truncated}...`
                    : truncated;
                await supabase
                  .from("conversations")
                  .update({ title })
                  .eq("id", chatId)
                  .eq("title", "New conversation"); // no-op if already renamed
              }

              await supabase
                .from("conversations")
                .update({ updated_at: new Date().toISOString() })
                .eq("id", chatId);
            } catch (err) {
              console.error("onFinish DB write failed:", err);
            }
          },
        });

        // Write the process step before merging the text stream so the
        // ProcessLog panel shows activity immediately.
        writer.write({
          type: "data-process",
          data: { step: "Generating response..." },
        });
        writer.merge(result.toUIMessageStream());
      },
    }),
  });
}
