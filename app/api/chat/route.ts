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

const SYSTEM_PROMPT = `You are Surftrip, an expert surf travel planning assistant.

You help surfers plan trips by researching destinations, surf breaks, swell conditions, travel logistics, and costs. You have deep knowledge of surf spots worldwide — wave quality, optimal seasons, crowd levels, ideal skill levels, and what to expect in the water.

When a user describes a destination and travel dates:
1. Assess the surf conditions and swell season for that window
2. Identify the best breaks for their skill level
3. Outline travel logistics (flights, transfers, accommodation options)
4. Give a realistic budget estimate

Be specific and practical. Surfers want actionable information, not vague travel writing. Stay in the conversation to answer follow-up questions.`;

const MAX_INPUT_LENGTH = 10_000;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { messages, chatId }: { messages: UIMessage[]; chatId: string } =
    await req.json();

  const lastMessage = messages.at(-1);
  const userContent =
    lastMessage?.parts.filter(isTextUIPart).map((p) => p.text).join("") ?? "";

  if (!userContent || userContent.trim().length === 0) {
    return new Response("Empty message", { status: 400 });
  }

  if (userContent.length > MAX_INPUT_LENGTH) {
    return new Response("Message too long", { status: 400 });
  }

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
          onFinish: async ({ response }) => {
            if (!user) return;

            const assistantMessage = response.messages.at(-1);
            const assistantContent = assistantMessage
              ? Array.isArray(assistantMessage.content)
                ? assistantMessage.content
                    .filter((p): p is { type: "text"; text: string } =>
                      p.type === "text",
                    )
                    .map((p) => p.text)
                    .join("")
                : String(assistantMessage.content)
              : "";

            try {
              await supabase.from("messages").insert([
                { conversation_id: chatId, role: "user", content: userContent },
                {
                  conversation_id: chatId,
                  role: "assistant",
                  content: assistantContent,
                },
              ]);

              if (messages.length === 1) {
                const title = userContent.slice(0, 60).trim();
                await supabase
                  .from("conversations")
                  .update({
                    title:
                      title.length < userContent.length
                        ? `${title}...`
                        : title,
                  })
                  .eq("id", chatId)
                  .eq("title", "New conversation");
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

        writer.write({ type: "data-process", data: { step: "Generating response..." } });
        writer.merge(result.toUIMessageStream());
      },
    }),
  });
}
