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
import { SYSTEM_PROMPT } from "@/lib/system-prompt";

// ── Constants ──────────────────────────────────────────────────────────────

// Must match MAX_LENGTH in ChatInput.tsx.
export const MAX_INPUT_LENGTH = 10_000;

// ── Types ──────────────────────────────────────────────────────────────────

// The AI SDK types tool results as unknown; we cast to this shape when reading
// them in onStepFinish to emit tool call events.
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

// ── Tool call helpers ──────────────────────────────────────────────────────

// Human-readable labels shown while a tool is running.
function toolStartLabel(toolName: string): string {
  const labels: Record<string, string> = {
    get_coordinates: "Looking up location...",
    get_swell_forecast: "Fetching swell forecast...",
    get_wind_and_weather: "Checking wind & weather...",
    get_tide_schedule: "Getting tide schedule...",
    get_buoy_observations: "Reading buoy data...",
    get_destination_info: "Loading destination info...",
    get_exchange_rate: "Checking exchange rates...",
    web_search_preview: "Searching the web...",
  };
  return labels[toolName] ?? `Running ${toolName}...`;
}

// Human-readable labels shown after a tool fails.
function toolErrorLabel(toolName: string): string {
  const labels: Record<string, string> = {
    get_coordinates: "Location lookup failed",
    get_swell_forecast: "Swell forecast unavailable",
    get_wind_and_weather: "Weather data unavailable",
    get_tide_schedule: "Tide schedule unavailable",
    get_buoy_observations: "Buoy data unavailable",
    get_destination_info: "Destination info unavailable",
    get_exchange_rate: "Exchange rate unavailable",
    web_search_preview: "Web search failed",
  };
  return labels[toolName] ?? `${toolName} failed`;
}

// Returns true when a tool result is an error object ({ error: string }).
function isToolError(output: Json): boolean {
  return (
    output !== null &&
    typeof output === "object" &&
    !Array.isArray(output) &&
    typeof (output as Record<string, Json>).error === "string"
  );
}

// Human-readable labels shown after a tool completes.
function toolDoneLabel(toolName: string): string {
  const labels: Record<string, string> = {
    get_coordinates: "Location resolved",
    get_swell_forecast: "Swell forecast loaded",
    get_wind_and_weather: "Weather data loaded",
    get_tide_schedule: "Tide schedule loaded",
    get_buoy_observations: "Buoy data loaded",
    get_destination_info: "Destination info loaded",
    get_exchange_rate: "Exchange rate loaded",
    web_search_preview: "Web search complete",
  };
  return labels[toolName] ?? toolName;
}

// Convert a compass bearing in degrees to a short cardinal/intercardinal label.
function degreesToCompass(deg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8];
}

// Return the first non-null number from an array of Json values.
function firstNum(arr: Json): number | null {
  if (!Array.isArray(arr)) return null;
  for (const v of arr) {
    if (typeof v === "number") return v;
  }
  return null;
}

// Extract a short summary string from a tool's result to display as detail
// text under the tool step. Returns undefined if the result doesn't contain
// anything useful to show.
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

    case "get_swell_forecast": {
      if (!r.daily || typeof r.daily !== "object" || Array.isArray(r.daily))
        break;
      const daily = r.daily as Record<string, Json>;
      const maxH = firstNum(daily.wave_height_max);
      const maxP = firstNum(daily.swell_wave_period_max);
      const dir = firstNum(daily.wave_direction_dominant);
      const days = Array.isArray(daily.time) ? daily.time.length : null;
      const parts: string[] = [];
      if (maxH != null && maxP != null) parts.push(`${maxH}m @ ${maxP}s`);
      if (dir != null) parts.push(degreesToCompass(dir));
      if (days != null) parts.push(`${days}-day forecast`);
      if (parts.length) return parts.join(" · ");
      break;
    }

    case "get_wind_and_weather": {
      if (!r.hourly || typeof r.hourly !== "object" || Array.isArray(r.hourly))
        break;
      const hourly = r.hourly as Record<string, Json>;
      const speed = firstNum(hourly.windspeed_10m);
      const gust = firstNum(hourly.windgusts_10m);
      const dirDeg = firstNum(hourly.winddirection_10m);
      const days =
        r.daily && typeof r.daily === "object" && !Array.isArray(r.daily)
          ? Array.isArray((r.daily as Record<string, Json>).time)
            ? ((r.daily as Record<string, Json>).time as Json[]).length
            : null
          : null;
      const parts: string[] = [];
      if (speed != null) {
        const dir = dirDeg != null ? ` ${degreesToCompass(dirDeg)}` : "";
        parts.push(`${Math.round(speed)} mph${dir}`);
      }
      if (gust != null) parts.push(`gusts ${Math.round(gust)} mph`);
      if (days != null) parts.push(`${days}-day forecast`);
      if (parts.length) return parts.join(" · ");
      break;
    }

    case "get_tide_schedule": {
      if (Array.isArray(r.predictions)) {
        type Prediction = { t: string; v: string; type: string };
        const preds = r.predictions as Prediction[];
        const nextHigh = preds.find((p) => p.type === "H");
        const station =
          typeof r.stationName === "string" ? r.stationName : null;
        const parts: string[] = [];
        if (station) parts.push(station);
        if (nextHigh) {
          const time = nextHigh.t.split(" ")[1]?.slice(0, 5) ?? nextHigh.t;
          parts.push(
            `Next high: ${Number(nextHigh.v).toFixed(1)}ft at ${time}`,
          );
        }
        return parts.length ? parts.join(" · ") : `${preds.length} tide events`;
      }
      if (typeof r.error === "string") return r.error;
      break;
    }

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

// Build the actual API URL for a given tool using args from onChunk and the
// result from onStepFinish. Returns a clickable URL to the raw API response.
function toolApiUrl(
  toolName: string,
  args: Json,
  result: Json,
): string | undefined {
  const a =
    args && typeof args === "object" && !Array.isArray(args)
      ? (args as Record<string, Json>)
      : {};
  const r =
    result && typeof result === "object" && !Array.isArray(result)
      ? (result as Record<string, Json>)
      : {};

  switch (toolName) {
    case "get_coordinates": {
      if (typeof a.query !== "string") return undefined;
      return `https://www.openstreetmap.org/search?query=${encodeURIComponent(a.query)}`;
    }
    case "get_swell_forecast":
    case "get_wind_and_weather":
      return "https://open-meteo.com";
    case "get_tide_schedule": {
      if (typeof r.stationId === "string") {
        return `https://tidesandcurrents.noaa.gov/stationhome.html?id=${r.stationId}`;
      }
      return "https://tidesandcurrents.noaa.gov";
    }
    case "get_buoy_observations": {
      if (typeof a.station_id !== "string") return undefined;
      return `https://www.ndbc.noaa.gov/station_page.php?station=${a.station_id}`;
    }
    case "get_destination_info":
      return "https://restcountries.com";
    case "get_exchange_rate":
      return "https://www.frankfurter.app";
    default:
      return undefined;
  }
}

// Build a short human-readable summary of the tool's input arguments.
function toolInputSummary(toolName: string, args: Json): string | undefined {
  const a =
    args && typeof args === "object" && !Array.isArray(args)
      ? (args as Record<string, Json>)
      : {};

  switch (toolName) {
    case "get_coordinates":
      return typeof a.query === "string" ? `"${a.query}"` : undefined;
    case "get_swell_forecast":
    case "get_wind_and_weather": {
      if (a.latitude == null || a.longitude == null) return undefined;
      const lat = Number(a.latitude).toFixed(2);
      const lon = Number(a.longitude).toFixed(2);
      const days = a.forecast_days ?? 5;
      return `${lat}°, ${lon}° · ${days} days`;
    }
    case "get_tide_schedule": {
      if (a.begin_date && a.end_date) {
        return `${a.begin_date} → ${a.end_date}`;
      }
      return undefined;
    }
    case "get_buoy_observations":
      return typeof a.station_id === "string"
        ? `Station ${a.station_id}`
        : undefined;
    case "get_destination_info":
      return typeof a.country === "string" ? a.country : undefined;
    case "get_exchange_rate":
      return typeof a.from === "string" && typeof a.to === "string"
        ? `${a.from.toUpperCase()} → ${a.to.toUpperCase()}`
        : undefined;
    default:
      return undefined;
  }
}

// Extract web search citation URLs from a web_search_preview tool result.
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
  // If Supabase is not configured, skip auth and run in guest-only mode.
  let supabase: Awaited<ReturnType<typeof createClient>> | null = null;
  let user = null;

  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    supabase = await createClient();
    const { data } = await supabase!.auth.getUser();
    user = data.user;
  }

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
  if (user && supabase) {
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
        // Keyed by toolCallId — lets us pass args from onChunk into onStepFinish
        // where the tool result is available but args are not.
        const toolCallArgsMap = new Map<string, Json>();

        const result = streamText({
          model: openai.responses("gpt-4o-mini"),
          system: SYSTEM_PROMPT,
          messages: await convertToModelMessages(messages),
          tools,

          // Cap at 10 tool-call steps per turn to prevent runaway loops.
          stopWhen: stepCountIs(10),

          onChunk: ({ chunk }) => {
            // Emit a tool-start event as soon as the model calls a tool, so
            // the UI shows activity before the result arrives.
            if (chunk.type === "tool-call") {
              toolCallArgsMap.set(chunk.toolCallId, chunk.input as Json);
              writer.write({
                type: "data-process",
                data: {
                  id: chunk.toolCallId,
                  kind: "tool-start",
                  toolName: chunk.toolName,
                  label: toolStartLabel(chunk.toolName),
                },
              });
            }
          },

          onStepFinish: ({ toolResults, response }) => {
            // Emit a tool call event for each completed tool. Errors get
            // "tool-error" (red); successes get "tool-done" (green).
            for (const tr of toolResults as ToolResultItem[]) {
              if (isToolError(tr.output)) {
                writer.write({
                  type: "data-process",
                  data: {
                    id: tr.toolCallId,
                    kind: "tool-error",
                    toolName: tr.toolName,
                    label: toolErrorLabel(tr.toolName),
                    error: (tr.output as Record<string, string>).error,
                  },
                });
                continue;
              }

              const args = toolCallArgsMap.get(tr.toolCallId) ?? null;
              const sources =
                tr.toolName === "web_search_preview"
                  ? extractSources(response.messages as ResponseMessage[])
                  : undefined;

              writer.write({
                type: "data-process",
                data: {
                  id: tr.toolCallId,
                  kind: "tool-done",
                  toolName: tr.toolName,
                  label: toolDoneLabel(tr.toolName),
                  detail: toolDetail(tr.toolName, tr.output),
                  params: toolInputSummary(tr.toolName, args),
                  apiUrl: toolApiUrl(tr.toolName, args, tr.output),
                  sources: sources?.length ? sources : undefined,
                },
              });
            }
          },

          onFinish: async ({ response }) => {
            if (!user || !supabase) return;

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

        // Emit a "Thinking..." status before merging the text stream so the
        // UI shows something immediately, before the first tool call or token.
        writer.write({
          type: "data-process",
          data: {
            id: crypto.randomUUID(),
            kind: "status",
            label: "Thinking...",
          },
        });

        writer.merge(result.toUIMessageStream());
      },
    }),
  });
}
