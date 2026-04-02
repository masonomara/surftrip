# Phase 2 Research — API Agent Implementation

## Overview

This document captures everything needed to implement the tool-calling AI agent in `app/api/route.ts`. It covers how the current codebase works, what must change, the exact Vercel AI SDK v6 patterns to use, and the full shape of every external API.

---

## 1. How the Current Codebase Works (Phase 1)

### Vercel AI SDK version

The project uses `ai@6.0.142` and `@ai-sdk/react@3.0.144`. These are the v6 packages — the API changed significantly from v4. Several things you'd find in blog posts or older docs are wrong for this version.

### The chat route (`app/api/route.ts`)

The current route does four things:

1. Authenticates the user with Supabase (guests are allowed, just not persisted to DB)
2. Parses `{ messages, chatId }` from the request body
3. Calls `streamText()` with a static system prompt and conversation history
4. Wraps everything in `createUIMessageStreamResponse()` so the client can read text chunks and custom data events in one SSE stream

Before the text stream starts, the route emits one process event:

```ts
writer.write({
  type: 'data-process',
  data: { step: 'Generating response...' },
});
writer.merge(result.toUIMessageStream());
```

The client (`ChatView.tsx`) receives this via `useChat`'s `onData` callback and pushes it to the `ProcessLogContext`, which renders it in the `ProcessLog` panel.

### ProcessLog flow (end-to-end)

```
Route: writer.write({ type: 'data-process', data: { step: '...' } })
  ↓
Client useChat onData: addStep(dataPart.data.step)
  ↓
ProcessLogContext: steps state grows
  ↓
ProcessLog component: re-renders, last non-"Done" step shows pulsing dot
```

After the stream ends, `ChatView.onFinish` calls `addStep('Done')` to stop the pulse.

### Message persistence

- **Authenticated users:** `onFinish` in the route handler saves both the user message and assistant response to Supabase `messages` table. Conversation title is auto-set from the first message (truncated to 60 chars).
- **Guests:** `ChatView.onFinish` saves to localStorage via `lib/local-storage.ts`.

### What's missing for Phase 2

The route has no `tools` parameter on `streamText()`. There are no tool definitions anywhere in the codebase. The system prompt is static. The process log only ever shows a single "Generating response..." step. Everything in `docs/02-api/01-goal.md` is unimplemented.

---

## 2. Vercel AI SDK v6 — Exact Patterns to Use

### Breaking changes from v4 (critical)

| v4 | v6 (what this project uses) |
| --- | --- |
| `parameters` in `tool()` | `inputSchema` |
| `maxSteps` in `streamText()` | `stopWhen: stepCountIs(N)` |
| `createDataStreamResponse()` | `createUIMessageStreamResponse()` |
| `writer.writeData()` | `writer.write({ type: 'data-*', data: ... })` |
| `useChat().handleSubmit` | `useChat().sendMessage` |
| `useChat().append` | `useChat().sendMessage` |

The project already uses the v6 patterns correctly in `ChatView.tsx` and `route.ts`. All tool code written for Phase 2 must follow v6 patterns.

### Defining tools

```ts
import { streamText, tool, stepCountIs } from 'ai';
import { z } from 'zod';

const result = streamText({
  model: openai('gpt-4o'),
  stopWhen: stepCountIs(10),  // required — default is 20, set explicitly
  messages: await convertToModelMessages(messages),
  system: SYSTEM_PROMPT,
  tools: {
    get_swell_forecast: tool({
      description: 'Fetch swell forecast data for a surf spot by coordinates.',
      inputSchema: z.object({         // NOTE: inputSchema, not parameters
        latitude: z.number(),
        longitude: z.number(),
        forecast_days: z.number().min(1).max(7).default(3),
      }),
      execute: async ({ latitude, longitude, forecast_days }) => {
        // fetch from Open-Meteo marine API
        const url = new URL('https://marine-api.open-meteo.com/v1/marine');
        // ... build URL, fetch, return data
        return data;
      },
    }),
    // ... more tools
  },
  onStepFinish: ({ stepNumber, toolCalls, toolResults }) => {
    // fires after each model call + tool execution round
    // use this to emit process log events mid-stream
  },
  onFinish: async ({ response }) => {
    // fires once after all steps complete
    // save assistant message to Supabase here (same as current pattern)
  },
});
```

### Emitting process events during tool execution

The process log must be updated before and after each tool call, not just at the start. The correct pattern uses `onStepFinish` on `streamText` to write data events:

```ts
const result = streamText({
  ...
  tools: { ... },
  onStepFinish: ({ toolCalls, toolResults }) => {
    // This fires synchronously after each step
    // writer is captured from the createUIMessageStream execute scope
    for (const tc of toolCalls) {
      writer.write({
        type: 'data-process',
        data: { step: `Called ${tc.toolName}` },
      });
    }
  },
});
```

However, `onStepFinish` runs after the step. To show "calling X..." _before_ the result arrives, the better pattern is to use `writer.write()` inside each tool's `execute` function — but `writer` is scoped to `createUIMessageStream.execute`. You either pass it down or use a ref.

The cleanest approach: emit a process event from `onStepFinish` for the completed tool call, and emit the initial "Researching surf conditions..." process event before `writer.merge()`. The process log will show tool calls as they complete.

### Client-side — reading tool call parts

The existing `useChat` hook in `ChatView.tsx` uses `onData` for custom data events. Tool call parts come through automatically on the `messages` array, not via `onData`. The message parts array looks like:

```ts
// After a tool call resolves, the assistant message has:
message.parts = [
  { type: 'text', text: 'Let me check the surf forecast...' },
  { type: 'tool-get_swell_forecast', state: 'output-available', input: {...}, output: {...} },
  { type: 'text', text: 'Here is what I found:...' },
]
```

Tool part states:
- `input-streaming` — model is generating tool arguments
- `input-available` — arguments are complete, `execute` hasn't returned yet
- `output-available` — `execute` returned, result is in `part.output`
- `output-error` — `execute` threw, error is in `part.errorText`

The `ChatMessages.tsx` component will need to handle `tool-*` parts to render loading states or results in the chat. For Phase 2, the minimum is to skip rendering tool parts (or show a subtle loading indicator).

---

## 3. Tool 01 — `get_swell_forecast` (Open-Meteo Marine)

**Base URL:** `https://marine-api.open-meteo.com/v1/marine`

**No API key. No rate limit documented. Free for non-commercial use.**

### Parameters

| Parameter | Type | Notes |
| --- | --- | --- |
| `latitude` | float | Required |
| `longitude` | float | Required |
| `hourly` | comma-list | Variable names (see below) |
| `daily` | comma-list | Daily aggregates |
| `forecast_days` | int | 1–16. Default 7. |
| `timezone` | string | e.g. `America/Los_Angeles`. Pass for correct local times. |

**Hourly variables:**

| Name | Unit | Description |
| --- | --- | --- |
| `wave_height` | m | Combined wave height |
| `wave_period` | s | Combined wave period |
| `wave_direction` | ° | Combined wave direction |
| `swell_wave_height` | m | Primary swell height |
| `swell_wave_period` | s | Primary swell period |
| `swell_wave_direction` | ° | Primary swell direction |
| `swell_wave_peak_period` | s | Peak swell period |
| `wind_wave_height` | m | Wind wave (chop) height |
| `wind_wave_period` | s | Wind wave period |
| `sea_surface_temperature` | °C | SST for wetsuit decision |

**Daily variables:**

| Name | Unit |
| --- | --- |
| `wave_height_max` | m |
| `swell_wave_height_max` | m |
| `swell_wave_period_max` | s |
| `wave_direction_dominant` | ° |

### Response shape

```json
{
  "latitude": 37.791664,
  "longitude": -122.37499,
  "utc_offset_seconds": -25200,
  "timezone": "America/Los_Angeles",
  "hourly_units": {
    "time": "iso8601",
    "wave_height": "m",
    "swell_wave_height": "m"
  },
  "hourly": {
    "time": ["2026-04-01T00:00", "2026-04-01T01:00"],
    "wave_height": [0.38, 0.42],
    "swell_wave_height": [0.3, 0.35],
    "swell_wave_period": [14.0, 14.5]
  },
  "daily": {
    "time": ["2026-04-01"],
    "wave_height_max": [0.9]
  }
}
```

**Gotcha:** The API snaps coordinates to the nearest ocean grid point. Inland coordinates will error or return unexpected data. Always call `get_coordinates` first to confirm a coastal location, then pass those coordinates here.

---

## 4. Tool 02 — `get_wind_and_weather` (Open-Meteo Weather)

**Base URL:** `https://api.open-meteo.com/v1/forecast`

**No API key. Free for non-commercial use.**

### Parameters

| Parameter | Type | Notes |
| --- | --- | --- |
| `latitude` | float | Required |
| `longitude` | float | Required |
| `hourly` | comma-list | Variable names (see below) |
| `daily` | comma-list | `sunrise`, `sunset`, `uv_index_max` |
| `wind_speed_unit` | string | `mph`, `kmh`, `ms`, `kn` |
| `forecast_days` | int | 1–16 |
| `timezone` | string | Required for local sunrise/sunset times |

**Hourly variables:**

| Name | Unit | Description |
| --- | --- | --- |
| `temperature_2m` | °C | Air temperature |
| `windspeed_10m` | depends on unit param | Wind speed |
| `winddirection_10m` | ° | Wind direction (where it's coming from) |
| `windgusts_10m` | same | Hourly max gusts |
| `precipitation_probability` | % | Rain chance |
| `cloudcover` | % | Cloud cover |
| `uv_index` | — | UV index |
| `weathercode` | WMO code | See WMO table for descriptions |

**Daily variables:** `sunrise`, `sunset` (ISO 8601 local time strings)

### Response shape

Same structure as marine API — `hourly_units` + parallel `hourly` arrays. Example:

```json
{
  "hourly": {
    "time": ["2026-04-01T00:00"],
    "windspeed_10m": [12.4],
    "winddirection_10m": [270],
    "windgusts_10m": [18.0]
  },
  "daily": {
    "time": ["2026-04-01"],
    "sunrise": ["2026-04-01T06:30"],
    "sunset": ["2026-04-01T19:45"]
  }
}
```

### Onshore/offshore computation

This is a derived output computed in the system prompt or in a helper, not a separate API call:

```
offshore = |windDirection - breakFacingDirection| in range 135–225°
onshore  = |windDirection - breakFacingDirection| in range 0–45° or 315–360°
cross    = everything else
```

Pass the break facing direction as a known constant per spot (e.g. Uluwatu faces SSW ≈ 200°).

---

## 5. Tool 03 — `get_tide_schedule` (NOAA CO-OPS)

**TideCheck has no documented public API as of April 2026.** Use NOAA CO-OPS directly. It is free, no key, unlimited requests, and covers all US coasts plus US territories.

### Step 1 — Find nearest station

```
GET https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/tidepredstations.json
  ?lat={lat}&lon={lon}&radius=50
```

Response: `{ stationList: [{ stationId: "9414290", etidesStnName: "...", distance: 0.97 }] }`

Take `stationList[0].stationId`.

### Step 2 — Fetch tide predictions

```
GET https://api.tidesandcurrents.noaa.gov/api/prod/datagetter
  ?station=9414290
  &product=predictions
  &begin_date=20260401
  &end_date=20260405
  &datum=MLLW
  &time_zone=lst_ldt
  &interval=hilo
  &units=english
  &application=surftrip
  &format=json
```

Date format is `YYYYMMDD` (no dashes).

### Response shape

```json
{
  "predictions": [
    { "t": "2026-04-01 05:47", "v": "0.444", "type": "L" },
    { "t": "2026-04-01 12:07", "v": "4.982", "type": "H" }
  ]
}
```

`v` is a string — parse with `parseFloat()`. `type` is `"H"` (high) or `"L"` (low).

### International locations

NOAA CO-OPS only covers US stations. For international surf spots (Bali, Mexico, Portugal), two options:

1. **WorldTides API** — global coverage, 100 free calls/month with API key. After that it is paid.
2. **Skip tides for international spots.** The AI can note that tides are not available and reason without them, or web_search for local tide information.

For Phase 2, implement NOAA CO-OPS for US spots, and have the tool return a clear error string for international coordinates so the AI can handle the gap gracefully.

---

## 6. Tool 04 — `get_buoy_observations` (NOAA NDBC)

**URL pattern:** `https://www.ndbc.noaa.gov/data/realtime2/{STATION_ID}.txt`

**Free, no key. Text format — needs parsing. CORS blocked in browser, fine from server-side route handler.**

### Column format (verified live)

```
#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS PTDY  TIDE
#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa  degC  degC  degC  nmi  hPa    ft
```

First two lines start with `#` (headers). Data lines follow, most recent first.

**Key columns:**

| Index | Name | Unit |
| --- | --- | --- |
| 8 | WVHT | m — significant wave height |
| 9 | DPD | sec — dominant wave period |
| 11 | MWD | degT — mean wave direction |
| 14 | WTMP | °C — water temperature |

Missing values are `MM`. Always check before parsing.

### Parser

```ts
async function parseBuoyData(stationId: string) {
  const res = await fetch(`https://www.ndbc.noaa.gov/data/realtime2/${stationId}.txt`);
  const text = await res.text();
  const lines = text.trim().split('\n').filter(l => !l.startsWith('#'));
  const cols = lines[0].trim().split(/\s+/);
  const mm = (v: string) => (v === 'MM' ? null : parseFloat(v));
  return {
    timestamp: `${cols[0]}-${cols[1]}-${cols[2]}T${cols[3]}:${cols[4]}:00Z`,
    waveHeight: mm(cols[8]),
    dominantPeriod: mm(cols[9]),
    meanWaveDirection: mm(cols[11]),
    waterTemp: mm(cols[14]),
  };
}
```

### Known buoy IDs per region

Store these as constants — there is no free "find nearest buoy" API:

| Buoy | Location |
| --- | --- |
| 46026 | San Francisco |
| 46025 | Santa Monica Basin, CA |
| 46047 | Tanner Banks, CA (offshore) |
| 51001 | Hawaii NW |
| 51101 | Waimea Bay, HI (nearshore) |
| 41047 | NE US, offshore |
| 46029 | Columbia River Bar, OR |

For international spots (Bali, Costa Rica, etc.), NDBC buoys are sparse or nonexistent. The tool should return a clear "no buoy near this location" message so the AI can skip it and rely on forecast-only data.

---

## 7. Tool 05 — `get_destination_info` (REST Countries)

**URL:** `https://restcountries.com/v3.1/name/{country}?fields=name,capital,currencies,languages,timezones,region,latlng`

**Free, no key.**

### Response shape (verified live — Indonesia)

```json
[{
  "name": { "common": "Indonesia", "official": "Republic of Indonesia" },
  "capital": ["Jakarta"],
  "currencies": { "IDR": { "name": "Indonesian rupiah", "symbol": "Rp" } },
  "languages": { "ind": "Indonesian" },
  "timezones": ["UTC+07:00", "UTC+08:00", "UTC+09:00"],
  "latlng": [-5.0, 120.0],
  "region": "Asia"
}]
```

Returns an array — always take `data[0]`. Limit fields with the `?fields=` parameter to keep payload small.

**For the AI, the most useful fields are:**

- `currencies` — currency code and symbol for budget estimates
- `timezones` — to convert session times to the user's home timezone
- `languages` — practical local language context

---

## 8. Tool 06 — `get_exchange_rate`

### Primary — Frankfurter

```
GET https://api.frankfurter.app/latest?from=USD&to=EUR,IDR,MXN
```

Response:

```json
{
  "amount": 1.0,
  "base": "USD",
  "date": "2026-04-01",
  "rates": { "EUR": 0.8617, "IDR": 16914, "MXN": 17.85 }
}
```

Free, no key. ECB-sourced. Covers ~30 major currencies. Updated daily on business days.

### Fallback — fawazahmed0 (150+ currencies via jsDelivr CDN)

```
GET https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json
```

Response: `{ "date": "2026-04-01", "usd": { "eur": 0.864, "idr": 17011, "mxn": 17.9, ... } }`

**Gotcha:** All keys are lowercase. `data.usd.idr`, not `data.USD.IDR`.

### Fallback pattern

```ts
async function getExchangeRate(from: string, to: string) {
  try {
    const res = await fetch(`https://api.frankfurter.app/latest?from=${from}&to=${to}`);
    const data = await res.json();
    return { rate: data.rates[to], source: 'frankfurter' };
  } catch {
    const res = await fetch(
      `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${from.toLowerCase()}.min.json`
    );
    const data = await res.json();
    return { rate: data[from.toLowerCase()][to.toLowerCase()], source: 'fawazahmed0' };
  }
}
```

---

## 9. Tool 07 — `get_coordinates` (Nominatim/OSM)

**Base URL:** `https://nominatim.openstreetmap.org/search`

**Free, no key. Rate limit: 1 request/second. User-Agent header required.**

### Request

```ts
const url = new URL('https://nominatim.openstreetmap.org/search');
url.searchParams.set('q', 'Uluwatu Bali');
url.searchParams.set('format', 'json');
url.searchParams.set('limit', '1');

const res = await fetch(url.toString(), {
  headers: { 'User-Agent': 'Surftrip/1.0 (contact@surftrip.fun)' },
});
const data = await res.json();
```

### Response shape

```json
[{
  "place_id": 12345,
  "lat": "-8.8291",
  "lon": "115.0849",
  "display_name": "Uluwatu, Kuta Selatan, Badung, Bali, Indonesia",
  "boundingbox": ["-8.8391", "-8.8191", "115.0749", "115.0949"]
}]
```

**Gotcha:** `lat` and `lon` are strings. Must `parseFloat()` before passing to other tools.

### Rate limiting strategy

The 1 req/sec limit is per IP. Since all requests go through a single Vercel serverless function, concurrent users share this limit. For Phase 2 (a demo project), this is fine — coordinate lookups are infrequent (one per conversation, at most). For production, cache coordinates by location name in Supabase or Redis.

---

## 10. Tool 08 — `web_search` (OpenAI Hosted)

### Critical: requires `openai.responses()`, not `openai()`

The `web_search_preview` tool is a provider-defined hosted tool that only works with the **Responses API model**:

```ts
import { openai } from '@ai-sdk/openai';

// WRONG — will error or not work:
const model = openai('gpt-4o');

// CORRECT:
const model = openai.responses('gpt-4o');
```

This means switching to `openai.responses()` for the entire route when web search is enabled. The regular chat completions model (`openai('gpt-4o')`) does not support hosted tools.

### Configuration

```ts
import { openai } from '@ai-sdk/openai';
import { streamText, tool, stepCountIs } from 'ai';

const result = streamText({
  model: openai.responses('gpt-4o'),  // Responses API model
  stopWhen: stepCountIs(10),
  tools: {
    web_search_preview: openai.tools.webSearchPreview({
      searchContextSize: 'low',  // 'low' | 'medium' | 'high' — affects cost
    }),
    get_swell_forecast: tool({ ... }),  // your own tools alongside it
    get_coordinates: tool({ ... }),
    // ...
  },
});
```

### What it does

`web_search_preview` is called with no arguments (the model controls the search query internally). OpenAI performs the search and returns grounded text. Inline URL citations appear in the model's response text as annotations.

No `execute` function is needed or possible — OpenAI handles execution.

### When to use it

Based on the goal doc, use `web_search_preview` for:

- Flight prices and routes (no free flight API exists)
- Accommodation costs (Hostelworld, surf camps)
- Local food/transport cost benchmarks (Numbeo, Nomad List)
- Spot-specific local knowledge (Surfline guides, surf-forecast.com)
- Visa requirements
- Board bag airline fees
- Live webcam links

### Cost note

Charged per call through the existing OpenAI account. No separate API key needed. Use `searchContextSize: 'low'` for cost efficiency on simple queries (visa requirements, fees). Use `'medium'` for richer surf spot context. The total cost per conversation is negligible for a demo.

---

## 11. Changes Required in `app/api/route.ts`

### What needs to change

1. **Switch model** from `openai('gpt-4o')` to `openai.responses('gpt-4o')` to support `web_search_preview`
2. **Add `stopWhen: stepCountIs(10)`** to cap the agent loop
3. **Add `tools` object** with all 8 tools defined
4. **Expand `onStepFinish`** to emit process events for each tool call
5. **Update system prompt** to instruct the AI when to use each tool and how to sequence calls
6. **Add tool implementation files** in `lib/tools/` (one per tool, or grouped)

### Suggested file structure

```
lib/
  tools/
    get-coordinates.ts        // Nominatim lookup
    get-swell-forecast.ts     // Open-Meteo marine
    get-wind-and-weather.ts   // Open-Meteo weather
    get-tide-schedule.ts      // NOAA CO-OPS
    get-buoy-observations.ts  // NOAA NDBC parser
    get-destination-info.ts   // REST Countries
    get-exchange-rate.ts      // Frankfurter + fawazahmed0
    index.ts                  // re-exports all tools for route.ts
```

### Updated route sketch

```ts
import { streamText, tool, stepCountIs, createUIMessageStream,
         createUIMessageStreamResponse, convertToModelMessages } from 'ai';
import { openai } from '@ai-sdk/openai';
import { tools } from '@/lib/tools';

export async function POST(req: Request) {
  // ... auth, parse, validate (same as current)

  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: async ({ writer }) => {
        // Initial process event
        writer.write({
          type: 'data-process',
          data: { step: 'Thinking about your surf trip...' },
        });

        const result = streamText({
          model: openai.responses('gpt-4o'),
          stopWhen: stepCountIs(10),
          system: UPDATED_SYSTEM_PROMPT,
          messages: await convertToModelMessages(messages),
          tools,

          onStepFinish: ({ toolCalls, toolResults }) => {
            for (const tc of toolCalls ?? []) {
              const label = toolCallLabel(tc.toolName);
              writer.write({
                type: 'data-process',
                data: { step: label },
              });
            }
          },

          onFinish: async ({ response }) => {
            // same DB save logic as current
          },
        });

        writer.merge(result.toUIMessageStream());
      },
    }),
  });
}

function toolCallLabel(toolName: string): string {
  const labels: Record<string, string> = {
    get_coordinates: 'Looking up location...',
    get_swell_forecast: 'Fetching swell forecast...',
    get_wind_and_weather: 'Checking wind and weather...',
    get_tide_schedule: 'Getting tide schedule...',
    get_buoy_observations: 'Reading buoy observations...',
    get_destination_info: 'Loading destination info...',
    get_exchange_rate: 'Checking exchange rates...',
    web_search_preview: 'Searching the web...',
  };
  return labels[toolName] ?? `Running ${toolName}...`;
}
```

---

## 12. System Prompt — What Needs to Change

The current system prompt is a persona definition with no tool instructions. For Phase 2, it needs:

1. **Tool sequencing instructions** — always call `get_coordinates` first before any coordinate-dependent tool
2. **When to use each tool** — swell + weather for any condition question, tides for session timing, buoy for "right now" verification, destination + exchange for trip planning, web_search for flights/accommodation/visa
3. **Derived output instructions** — how to calculate onshore/offshore, session windows, wetsuit choice, board recommendation
4. **Honest fallback language** — what to say when a tool returns nothing (e.g. no buoy near an international spot)
5. **Output format** — how to present the aggregated data in a readable way

---

## 13. ChatMessages Component — Handling Tool Parts

`ChatMessages.tsx` currently renders `message.parts` by filtering for `isTextUIPart`. Tool call parts (typed `tool-get_swell_forecast`, etc.) will appear in the parts array during and after tool execution.

Minimum change: filter them out of the rendered output so users don't see raw JSON. Better: render a subtle "Checked swell data" inline indicator. The process log already handles the narrative — `ChatMessages` should stay clean.

```ts
// Minimal — skip tool parts
{message.parts.map((part, i) => {
  if (!isTextUIPart(part)) return null;
  return <Markdown key={i}>{part.text}</Markdown>;
})}
```

---

## 14. Key Gotchas Summary

| Gotcha | Impact |
| --- | --- |
| `inputSchema` not `parameters` in `tool()` | Tool definitions will fail silently or throw at runtime |
| `stopWhen: stepCountIs(N)` not `maxSteps` | Without it, default is 20 steps — runaway cost possible |
| `openai.responses()` required for `web_search_preview` | Will error if you use `openai()` (chat model) |
| Nominatim `lat`/`lon` are strings | `parseFloat()` required before passing to Open-Meteo |
| NDBC missing values are `MM` string | Check before `parseFloat()` or you get `NaN` |
| NOAA CO-OPS dates are `YYYYMMDD` | Dashes cause a 400 response |
| NOAA CO-OPS `v` (water level) is a string | `parseFloat()` required |
| Open-Meteo marine API requires ocean coords | Inland coordinates will error |
| fawazahmed0 keys are lowercase | `data.usd.idr` not `data.USD.IDR` |
| TideCheck has no documented API | Use NOAA CO-OPS for US, acknowledge gap for international |
| NDBC CORS blocked in browser | Must call from server-side route handler only |
| `onStepFinish` fires after — not before — tool execution | Emit "calling X..." via a different mechanism if needed |
