import { openai } from "@ai-sdk/openai";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  convertToModelMessages,
  streamText,
  isTextUIPart,
  stepCountIs,
} from "ai";
import type { UIMessage } from "ai";
import { createClient } from "@/lib/supabase/server";
import type { ProcessSource, Json } from "@/lib/types";
import { tools } from "@/lib/tools";

// ── System prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Surftrip — a surf travel planning assistant with access to real-time data tools. Think of yourself as that guy in the crew who's actually been there, surfed it, got worked by it, and can give you the real talk before you book anything. No fluff, no travel-writing poetry. Just the actual intel.

You help surfers plan trips. Destinations, breaks, swell windows, logistics, what it's gonna cost. The stuff you actually need to know.

## Tool sequencing

Always run these in order when someone asks about a spot:

1. Call get_coordinates first — every other tool needs the lat/lon, so don't skip this.
2. Call get_swell_forecast and get_wind_and_weather together. They both need coordinates and they cover different things.
3. Call get_tide_schedule if it's a US spot or US territory. International? Skip it and flag the gap.
4. Call get_buoy_observations if there's a known NDBC buoy nearby — US and Pacific spots mainly. If the tool errors out, move on and work with the forecast data.
5. Call get_destination_info and get_exchange_rate together — that's the logistics side of things.
6. Use web_search_preview for flights, accommodation, visa stuff, local costs, and any spot-specific knowledge the structured tools just won't have.

## When to skip tools

- Tide schedule: US locations only. For Bali, Mexico, Portugal — whatever — just note that tide data isn't available and work around it.
- Buoy observations: only call this when you actually know a relevant buoy station exists nearby. If it errors, skip it.
- Exchange rate: skip if the destination runs on USD.
- Destination info: skip for domestic US trips.

## Derived outputs — compute these yourself from what you pull

**Onshore vs. offshore:** Take wind_direction_10m from get_wind_and_weather and compare it against the break's facing direction. Within 45° behind the wave = offshore, that's good. Within 45° into the face = onshore, that's bad. Everything else is cross-shore.

**Best session window:** Find the hours where the wind is offshore or light cross-shore, tide is sitting in the spot's optimal range, swell period is above 10s, and it's daylight. That's the window. Be specific with times.

**Wetsuit recommendation:**
- Sea surface temp above 24°C → boardshorts, you're fine
- 20–24°C → springsuit
- 17–20°C → 3/2mm full suit
- 13–17°C → 4/3mm full suit
- Below 13°C → 5/4mm, boots, hood — the full kit

**Board recommendation:** Pull swell height and period from get_swell_forecast. Face height is roughly swell height × 1.3–1.5. Higher period and hollow = step-up or gun. Lower period and mushy = fish or mid-length. If they're a beginner, more volume regardless of conditions — don't let them get worked on the wrong board.

**Daily budget:** Use currency from get_destination_info plus the rate from get_exchange_rate plus cost benchmarks from web_search. Convert everything to their home currency and make it make sense.

## Output format

Give them the stuff that matters, in this order:
- Swell and conditions summary first — that's always the most important thing
- Best session window with actual times, not vague windows
- Break recommendations matched to their level
- Wetsuit and board call
- Logistics — flights, where to stay, getting around
- Realistic daily budget, not optimistic travel-blog numbers
- Visa and practical notes if they're relevant

## When the forecast window runs out — don't make stuff up

The forecast tools cover roughly 14 days. If someone's asking about conditions further out than that, don't invent a forecast — that's not useful to anyone.

Here's what you do instead:

1. Say clearly that real forecast data doesn't exist that far out. One hundred percent honest about that.
2. Use web_search_preview to pull up historical swell patterns and seasonal norms for that destination and time of year.
3. Give them an honest read on what typically happens — average swell size, dominant direction, wind patterns, rainy vs. dry season, crowd levels — based on what you actually find.
4. Frame it as historical context and seasonal averages. Not a forecast. Never present it as a forecast.

The whole point is to give them the real talk so they know if it's worth getting on the plane.`;

// ── Constants ──────────────────────────────────────────────────────────────

// Must match MAX_LENGTH in ChatInput.tsx.
const MAX_INPUT_LENGTH = 10_000;

// ── Types ──────────────────────────────────────────────────────────────────

// The AI SDK types tool results as unknown; we cast to this shape when reading
// them in onStepFinish to build process log events.
type ToolResultItem = { toolCallId: string; toolName: string; output: Json };

// web_search_preview returns its citations as annotations on text parts.
// This type matches the shape we parse from response.messages.
type ResponseMessage = {
  content:
    | string
    | Array<{
        type: string;
        text?: string;
        annotations?: Array<{
          type: string;
          url_citation?: { url: string; title?: string };
        }>;
      }>;
};

// ── Process log helpers ────────────────────────────────────────────────────

// Human-readable labels for the process log shown while a tool is running.
function toolStartLabel(toolName: string): string {
  const labels: Record<string, string> = {
    get_coordinates:      "Looking up location...",
    get_swell_forecast:   "Fetching swell forecast...",
    get_wind_and_weather: "Checking wind & weather...",
    get_tide_schedule:    "Getting tide schedule...",
    get_buoy_observations: "Reading buoy data...",
    get_destination_info: "Loading destination info...",
    get_exchange_rate:    "Checking exchange rates...",
    web_search_preview:   "Searching the web...",
  };
  return labels[toolName] ?? `Running ${toolName}...`;
}

// Human-readable labels for the process log shown after a tool completes.
function toolDoneLabel(toolName: string): string {
  const labels: Record<string, string> = {
    get_coordinates:      "Location resolved",
    get_swell_forecast:   "Swell forecast loaded",
    get_wind_and_weather: "Weather data loaded",
    get_tide_schedule:    "Tide schedule loaded",
    get_buoy_observations: "Buoy data loaded",
    get_destination_info: "Destination info loaded",
    get_exchange_rate:    "Exchange rate loaded",
    web_search_preview:   "Web search complete",
  };
  return labels[toolName] ?? toolName;
}

// Extract a short summary string from a tool's result to display as detail
// text under the tool step in the process log. Returns undefined if the result
// doesn't contain anything useful to show.
function toolDetail(toolName: string, result: Json): string | undefined {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return undefined;
  }
  const r = result as Record<string, Json>;

  switch (toolName) {
    case "get_coordinates":
      if (r.lat != null && r.lon != null && r.displayName) {
        return `${r.displayName} → ${r.lat}°, ${r.lon}°`;
      }
      break;
    case "get_swell_forecast":
      if (r.hourly) return "7-day marine forecast loaded";
      break;
    case "get_wind_and_weather":
      if (r.hourly) return "7-day weather forecast loaded";
      break;
    case "get_tide_schedule":
      if (Array.isArray(r.predictions)) {
        return `${r.predictions.length} tide events`;
      }
      if (typeof r.error === "string") return r.error;
      break;
    case "get_buoy_observations":
      if (r.waveHeight != null && r.dominantPeriod != null) {
        return `${r.waveHeight}m @ ${r.dominantPeriod}s`;
      }
      if (typeof r.error === "string") return r.error;
      break;
    case "get_destination_info":
      if (r.currencyCode && r.timezone) {
        return `${r.name} — ${r.currencyCode} — ${r.timezone}`;
      }
      break;
    case "get_exchange_rate":
      if (r.rate != null && r.from && r.to) {
        return `1 ${r.from} = ${Number(r.rate).toLocaleString()} ${r.to}`;
      }
      break;
  }
  return undefined;
}

// Extract web search citation URLs from a web_search_preview response.
// The AI SDK returns citations as `url_citation` annotations on text parts.
function extractSources(responseMessages: ResponseMessage[]): ProcessSource[] {
  const sources: ProcessSource[] = [];

  for (const msg of responseMessages) {
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (part.type !== "text" || !Array.isArray(part.annotations)) continue;
      for (const ann of part.annotations) {
        if (ann.type !== "url_citation" || !ann.url_citation?.url) continue;

        let title = ann.url_citation.title ?? "";
        if (!title) {
          try {
            title = new URL(ann.url_citation.url).hostname;
          } catch {
            title = ann.url_citation.url;
          }
        }
        sources.push({ url: ann.url_citation.url, title });
      }
    }
  }

  return sources;
}

// ── Route handler ──────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { messages, chatId }: { messages: UIMessage[]; chatId: string } =
    await req.json();

  // Extract the plain text of the last message for validation and DB storage.
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
          model: openai.responses("gpt-4o-mini"),
          system: SYSTEM_PROMPT,
          messages: await convertToModelMessages(messages),
          tools,

          // Cap at 10 tool-call steps per turn to prevent runaway loops.
          stopWhen: stepCountIs(10),

          onChunk: ({ chunk }) => {
            // Stream a "tool-start" process event as soon as the model calls a
            // tool, so the ProcessLog shows activity before the result arrives.
            if (chunk.type === "tool-call") {
              writer.write({
                type: "data-process",
                data: {
                  id:       chunk.toolCallId,
                  kind:     "tool-start",
                  toolName: chunk.toolName,
                  label:    toolStartLabel(chunk.toolName),
                },
              });
            }
          },

          onStepFinish: ({ toolResults, response }) => {
            // Stream a "tool-done" process event for each completed tool call,
            // including a detail summary and any web search citation sources.
            for (const tr of toolResults as ToolResultItem[]) {
              const sources =
                tr.toolName === "web_search_preview"
                  ? extractSources(response.messages as ResponseMessage[])
                  : undefined;

              writer.write({
                type: "data-process",
                data: {
                  id:       tr.toolCallId,
                  kind:     "tool-done",
                  toolName: tr.toolName,
                  label:    toolDoneLabel(tr.toolName),
                  detail:   toolDetail(tr.toolName, tr.output),
                  sources:  sources?.length ? sources : undefined,
                },
              });
            }
          },

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
                { conversation_id: chatId, role: "user",      content: userContent      },
                { conversation_id: chatId, role: "assistant", content: assistantContent },
              ]);

              // Set the conversation title from the first user message, but
              // only if the title is still the default "New conversation".
              // This avoids overwriting a title set by a previous exchange.
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

        // Write the "Thinking..." status before merging the text stream.
        // This ensures the ProcessLog shows something immediately, even before
        // the first tool call or text token arrives.
        writer.write({
          type: "data-process",
          data: {
            id:    crypto.randomUUID(),
            kind:  "status",
            label: "Thinking...",
          },
        });

        writer.merge(result.toUIMessageStream());
      },
    }),
  });
}
