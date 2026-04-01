# Plan — Streaming Process Log with Tool Calls and Sources

## Overview

The current process log emits one event per response: `"Generating response..."`, then `"Done"`. Phase 2 replaces this with a live feed of the AI's tool-calling sequence — each tool fires a "calling..." indicator immediately, then updates in place with a result summary and (for web search) clickable source links, all while the chat streams in parallel.

The architecture change is surgical. Six files need modification; no new dependencies are required.

---

## What Changes

| File                               | Change                                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------------------- |
| `lib/types.ts`                     | Add `ProcessStep`, `ProcessSource`, `ProcessDataEvent` types. Update `AppDataTypes`.   |
| `lib/process-log-context.tsx`      | `steps: string[]` → `steps: ProcessStep[]`. `addStep` → `addEvent` with upsert logic.  |
| `app/api/route.ts`                 | Add `onChunk` (tool-start) + `onStepFinish` (tool-done + sources). Richer data events. |
| `components/ChatView.tsx`          | `onData` handler calls `addEvent` instead of `addStep`. Adjust `onFinish`.             |
| `components/ProcessLog.tsx`        | Render structured steps: dot + label + detail + source links.                          |
| `components/ProcessLog.module.css` | New styles for detail text, source list, error dot.                                    |

---

## Step 1 — New Types (`lib/types.ts`)

### The core problem with the current type

`AppDataTypes = { process: { step: string } }` carries only a flat string. There is no way to update an existing step in place (e.g. "Fetching swell..." → "Swell loaded — 1.4m @ 14s"), and no structure for sources.

### New types to add

```ts
// ── Process log types ─────────────────────────────────────────────────────

export type ProcessSource = {
  title: string;
  url: string;
};

// A step rendered in the ProcessLog panel.
// 'status' steps are simple labels (thinking, done).
// 'tool' steps are created when a tool is called and updated when it returns.
export type ProcessStep =
  | {
      id: string;
      kind: "status";
      label: string;
      status: "active" | "done";
    }
  | {
      id: string;
      kind: "tool";
      toolName: string;
      label: string;
      status: "active" | "done" | "error";
      detail?: string;
      sources?: ProcessSource[];
    };

// Events that stream from the route handler to the client.
// 'tool-start'  → creates a new active tool step
// 'tool-done'   → finds step by id, updates it to done + adds detail/sources
// 'tool-error'  → finds step by id, marks it as error
// 'status'      → appends a simple status step
export type ProcessDataEvent =
  | { id: string; kind: "status"; label: string }
  | { id: string; kind: "tool-start"; toolName: string; label: string }
  | {
      id: string;
      kind: "tool-done";
      toolName: string;
      label: string;
      detail?: string;
      sources?: ProcessSource[];
    }
  | {
      id: string;
      kind: "tool-error";
      toolName: string;
      label: string;
      error: string;
    };
```

### Update `AppDataTypes`

```ts
// Before:
export type AppDataTypes = { process: { step: string } };

// After:
export type AppDataTypes = { process: ProcessDataEvent };
```

`AppMessage` (which is `UIMessage<unknown, AppDataTypes>`) does not change — only what lives inside `data-process` events changes.

---

## Step 2 — Upgrade ProcessLogContext (`lib/process-log-context.tsx`)

### What changes

`steps: string[]` → `steps: ProcessStep[]`

`addStep(step: string)` → `addEvent(event: ProcessDataEvent)` with upsert logic:

- `kind: 'status'` → append a new step
- `kind: 'tool-start'` → append a new step with `status: 'active'`
- `kind: 'tool-done'` → find step by `id`, update it in place (status, detail, sources)
- `kind: 'tool-error'` → find step by `id`, update it to `status: 'error'`

`clearSteps()` stays the same.

### Full replacement

```tsx
"use client";

import { createContext, useContext, useState } from "react";
import type { ProcessStep, ProcessDataEvent } from "@/lib/types";

type ProcessLogContextType = {
  steps: ProcessStep[];
  addEvent: (event: ProcessDataEvent) => void;
  clearSteps: () => void;
};

const ProcessLogContext = createContext<ProcessLogContextType | null>(null);

type Props = { children: React.ReactNode };

export function ProcessLogProvider({ children }: Props) {
  const [steps, setSteps] = useState<ProcessStep[]>([]);

  function addEvent(event: ProcessDataEvent) {
    setSteps((prev) => {
      // For 'tool-done' and 'tool-error', find the existing step by id and
      // update it in place. This collapses "Fetching..." → "Fetched." into
      // a single line rather than two separate rows.
      if (event.kind === "tool-done") {
        return prev.map((s) =>
          s.id === event.id
            ? {
                ...s,
                kind: "tool" as const,
                label: event.label,
                status: "done" as const,
                detail: event.detail,
                sources: event.sources,
              }
            : s,
        );
      }

      if (event.kind === "tool-error") {
        return prev.map((s) =>
          s.id === event.id
            ? { ...s, label: event.label, status: "error" as const }
            : s,
        );
      }

      // 'tool-start' and 'status' append a new step.
      if (event.kind === "tool-start") {
        const newStep: ProcessStep = {
          id: event.id,
          kind: "tool",
          toolName: event.toolName,
          label: event.label,
          status: "active",
        };
        return [...prev, newStep];
      }

      // kind === 'status'
      const newStep: ProcessStep = {
        id: event.id,
        kind: "status",
        label: event.label,
        status: event.label === "Done" ? "done" : "active",
      };
      return [...prev, newStep];
    });
  }

  function clearSteps() {
    setSteps([]);
  }

  return (
    <ProcessLogContext.Provider value={{ steps, addEvent, clearSteps }}>
      {children}
    </ProcessLogContext.Provider>
  );
}

export function useProcessLog(): ProcessLogContextType {
  const context = useContext(ProcessLogContext);
  if (!context) {
    throw new Error("useProcessLog must be used within a <ProcessLogProvider>");
  }
  return context;
}
```

---

## Step 3 — Route Handler (`app/api/route.ts`)

### The two new callbacks

**`onChunk`** fires synchronously as each chunk of the stream is processed. When `chunk.type === 'tool-call'`, the model has decided to call a tool but `execute()` hasn't run yet. This is the right moment to emit `tool-start` so the UI shows "Fetching swell forecast..." immediately — before any network call goes out.

**`onStepFinish`** fires after all tool calls in a step have resolved and their results have been sent back to the model. This is where we emit `tool-done` with the detail summary and sources extracted from tool results.

Both callbacks have access to `writer` via closure because they're defined inside the `execute` function of `createUIMessageStream`.

### Writer access pattern (critical)

```ts
execute: async ({ writer }) => {
  // writer is captured here in the outer closure.
  // onChunk and onStepFinish close over it.

  const result = streamText({
    onChunk: ({ chunk }) => {
      // writer is accessible here — same execution context.
    },
    onStepFinish: ({ toolResults }) => {
      // writer is accessible here too.
    },
  });

  writer.write({ type: "data-process", data: { ... } });
  writer.merge(result.toUIMessageStream());
}
```

### Helper functions (add above `POST`)

```ts
// Generates a unique ID for each process event. Used to correlate
// tool-start and tool-done events for the same tool call.
function eventId(toolCallId?: string): string {
  return toolCallId ?? crypto.randomUUID();
}

// Human-readable label for the tool-start event.
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

// Human-readable label for the tool-done event.
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

// Converts a tool result into a one-line summary string for the process log.
// Each tool returns a different shape; this extracts the most useful fact.
function toolDetail(toolName: string, result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const r = result as Record<string, unknown>;

  switch (toolName) {
    case "get_coordinates":
      if (r.lat && r.lon) return `${r.displayName} → ${r.lat}°, ${r.lon}°`;
      break;
    case "get_swell_forecast":
      if (r.hourly) return "7-day marine forecast loaded";
      break;
    case "get_wind_and_weather":
      if (r.hourly) return "7-day weather forecast loaded";
      break;
    case "get_tide_schedule":
      if (Array.isArray(r.predictions)) {
        return `${r.predictions.length} tide events loaded`;
      }
      break;
    case "get_buoy_observations":
      if (r.waveHeight != null && r.dominantPeriod != null) {
        return `${r.waveHeight}m @ ${r.dominantPeriod}s`;
      }
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

type UrlCitation = {
  type: "url_citation";
  url_citation: { url: string; title: string };
};

// Extracts URL citations from the Responses API step response messages.
// These come from web_search_preview as inline annotations on the assistant text.
function extractSources(
  responseMessages: Array<{ content: unknown }>,
): ProcessSource[] {
  const sources: ProcessSource[] = [];
  for (const msg of responseMessages) {
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (
        part &&
        typeof part === "object" &&
        "type" in part &&
        part.type === "text" &&
        "annotations" in part &&
        Array.isArray((part as { annotations: unknown[] }).annotations)
      ) {
        for (const ann of (part as { annotations: UrlCitation[] })
          .annotations) {
          if (ann.type === "url_citation") {
            sources.push({
              url: ann.url_citation.url,
              title:
                ann.url_citation.title ||
                new URL(ann.url_citation.url).hostname,
            });
          }
        }
      }
    }
  }
  return sources;
}
```

### Updated `streamText` call inside `execute`

```ts
execute: async ({ writer }) => {
  const result = streamText({
    model: openai("gpt-4o"),  // switch to openai.responses("gpt-4o") when adding web_search_preview
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    stopWhen: stepCountIs(10),  // import stepCountIs from 'ai'

    // onChunk fires as stream chunks arrive. When the model emits a tool-call
    // chunk, fire a tool-start event immediately — before execute() runs.
    // This gives the user instant feedback that something is happening.
    onChunk: ({ chunk }) => {
      if (chunk.type === "tool-call") {
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

    // onStepFinish fires after all tool calls in a step have resolved.
    // Update each tool-start step to done, add detail and sources.
    onStepFinish: ({ toolCalls, toolResults, response }) => {
      for (const tr of toolResults) {
        const sources =
          tr.toolName === "web_search_preview"
            ? extractSources(
                response.messages as Array<{ content: unknown }>,
              )
            : undefined;

        writer.write({
          type: "data-process",
          data: {
            id: tr.toolCallId,
            kind: "tool-done",
            toolName: tr.toolName,
            label: toolDoneLabel(tr.toolName),
            detail: toolDetail(tr.toolName, tr.result),
            sources: sources?.length ? sources : undefined,
          },
        });
      }
    },

    onFinish: async ({ response }) => {
      // ... existing DB save logic, unchanged
    },
  });

  // Emit the initial "thinking" status before the stream starts.
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
```

---

## Step 4 — ChatView (`components/ChatView.tsx`)

Two small changes:

**1. Import `addEvent` instead of `addStep`:**

```ts
// Before:
const { addStep, clearSteps } = useProcessLog();

// After:
const { addEvent, clearSteps } = useProcessLog();
```

**2. `onData` handler:**

```ts
// Before:
onData: (dataPart) => {
  if (dataPart.type === "data-process") {
    addStep(dataPart.data.step);
  }
},

// After:
onData: (dataPart) => {
  if (dataPart.type === "data-process") {
    addEvent(dataPart.data);
  }
},
```

**3. `onFinish` "Done" event:**

```ts
// Before:
onFinish: ({ messages: finishedMessages }) => {
  addStep("Done");
  // ...
};

// After:
onFinish: ({ messages: finishedMessages }) => {
  addEvent({ id: crypto.randomUUID(), kind: "status", label: "Done" });
  // ...
};
```

---

## Step 5 — ProcessLog Component (`components/ProcessLog.tsx`)

The component needs to handle three rendering modes per step:

1. **Status step** (`kind: 'status'`) — same as today, just a label with a dot
2. **Tool step, active** (`kind: 'tool', status: 'active'`) — pulsing amber dot + label
3. **Tool step, done** (`kind: 'tool', status: 'done'`) — green dot + label + optional detail + optional source links
4. **Tool step, error** (`kind: 'tool', status: 'error'`) — red dot + label

```tsx
"use client";

import { useProcessLog } from "@/lib/process-log-context";
import type { ProcessStep } from "@/lib/types";
import styles from "./ProcessLog.module.css";

type Props = {
  onClose?: () => void;
};

function dotClass(step: ProcessStep): string {
  if (step.status === "active") return `${styles.dot} ${styles.dotActive}`;
  if (step.status === "error") return `${styles.dot} ${styles.dotError}`;
  return styles.dot;
}

export default function ProcessLog({ onClose }: Props) {
  const { steps } = useProcessLog();

  return (
    <aside className={styles.panel}>
      <div className={styles.headerRow}>
        <h2 className={styles.heading}>Process log</h2>
        {onClose && (
          <button
            onClick={onClose}
            className={styles.closeBtn}
            type="button"
            aria-label="Close process log"
          >
            ×
          </button>
        )}
      </div>

      <div className={styles.events}>
        {steps.length === 0 ? (
          <p className={styles.empty}>
            Steps will appear here as the AI works.
          </p>
        ) : (
          steps.map((step) => (
            <div key={step.id} className={styles.event}>
              <div className={styles.eventHeader}>
                <span className={dotClass(step)} />
                <span className={styles.label}>{step.label}</span>
              </div>

              {/* One-line detail summary for completed tool steps */}
              {step.kind === "tool" && step.detail && (
                <p className={styles.detail}>{step.detail}</p>
              )}

              {/* Clickable source links from web_search_preview */}
              {step.kind === "tool" &&
                step.sources &&
                step.sources.length > 0 && (
                  <ul className={styles.sources}>
                    {step.sources.map((source) => (
                      <li key={source.url} className={styles.sourceItem}>
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.sourceLink}
                          title={source.url}
                        >
                          {source.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
```

---

## Step 6 — ProcessLog CSS (`components/ProcessLog.module.css`)

Add three new rule sets to the bottom of the existing file. The existing rules (`panel`, `headerRow`, `heading`, `events`, `empty`, `event`, `eventHeader`, `dot`, `dotActive`, `label`, `closeBtn`) are unchanged.

```css
/* ── Tool step detail ───────────────── */

.detail {
  margin: 0 0 4px 15px; /* indent to align under label, past the dot */
  color: var(--text-tertiary);
  font-size: 12px;
  line-height: 16px;
}

/* ── Source links ───────────────────── */

.sources {
  list-style: none;
  margin: 0 0 6px 15px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sourceItem {
  display: flex;
  align-items: center;
  gap: 4px;
}

.sourceItem::before {
  content: "↳";
  color: var(--text-tertiary);
  font-size: 11px;
  flex-shrink: 0;
}

.sourceLink {
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 16px;
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 220px;
}

.sourceLink:hover {
  color: var(--text-primary);
  text-decoration: underline;
}

/* ── Error dot ──────────────────────── */

.dotError {
  background: var(--error-primary, #e53935);
}
```

---

## How It All Works Together (Sequence Diagram)

```
User sends message
  │
  ▼
ChatView.handleSend()
  → clearSteps()
  → sendMessage({ text })
  │
  ▼
POST /api
  │
  ├─ writer.write({ kind: 'status', label: 'Thinking...' })
  │    → client addEvent() → appends status step
  │
  ├─ streamText starts → model calls get_coordinates
  │
  ├─ onChunk({ type: 'tool-call', toolCallId: 'tc-1', toolName: 'get_coordinates' })
  │    → writer.write({ id: 'tc-1', kind: 'tool-start', label: 'Looking up location...' })
  │    → client addEvent() → appends tool step, status: 'active', pulsing dot shown
  │
  ├─ execute() runs → Nominatim fetch resolves
  │
  ├─ onStepFinish({ toolResults: [{ toolCallId: 'tc-1', result: { lat, lon, displayName } }] })
  │    → writer.write({ id: 'tc-1', kind: 'tool-done', detail: 'Uluwatu, Bali → -8.83°, 115.08°' })
  │    → client addEvent() → UPDATES step in place: dot turns green, detail appears
  │
  ├─ model calls get_swell_forecast (same pattern)
  │
  ├─ model calls web_search_preview
  │    → onChunk emits tool-start 'Searching the web...'
  │    → execute runs (OpenAI handles it)
  │    → onStepFinish extracts URL citations from response.messages annotations
  │    → writer.write({ id: 'tc-3', kind: 'tool-done', label: 'Web search complete',
  │         sources: [{ title: 'Surfline Uluwatu Guide', url: '...' }, ...] })
  │    → client addEvent() → step updates, source links appear
  │
  ├─ text stream flows → ChatMessages renders markdown in real-time
  │
  └─ stream closes
       → onFinish() → saves to Supabase
       → ChatView.onFinish() → addEvent({ kind: 'status', label: 'Done' })
```

---

## Important Notes

### `onChunk` runs synchronously during stream processing

`onChunk` fires as each chunk is dequeued from the `ReadableStream`. Calling `writer.write()` inside `onChunk` inserts the data event into the response stream immediately — before the tool's `execute()` runs. This is what gives the "instant" tool-start indicator.

### `onStepFinish` updates in place via `id`

The `id` on each event is the `toolCallId` generated by the model. `tool-start` and `tool-done` events share the same `toolCallId`, which is why the context's `addEvent` can find the existing step and update it rather than appending a new row.

### `web_search_preview` sources come from response annotations

OpenAI's Responses API injects `url_citation` annotations into the assistant text message. They are not in the tool result object itself — they are in `response.messages` from `onStepFinish`. The `extractSources` helper walks those messages to find them.

### Two tools can run in parallel within one step

If the model emits multiple tool calls in a single step (which GPT-4o supports), `onChunk` fires multiple `tool-call` chunks — one per tool — and `onStepFinish` fires once with all results. Each tool gets its own step entry since they have different `toolCallId` values.

### No new dependencies

`crypto.randomUUID()` is available in the Node.js runtime (Next.js route handlers run on Node). No uuid package needed.

---

## Implementation Order

1. `lib/types.ts` — add types, update `AppDataTypes`
2. `lib/process-log-context.tsx` — swap to structured steps with `addEvent`
3. `components/ChatView.tsx` — swap `addStep` calls to `addEvent`
4. `app/api/route.ts` — add `onChunk`, `onStepFinish`, helper functions
5. `components/ProcessLog.tsx` — rework rendering
6. `components/ProcessLog.module.css` — add detail + source + error styles

Do steps 1–3 together first (they're tightly coupled type changes) and verify the app still loads before touching the route and component rendering.

---

## Todo List

### Phase A — Type Foundation

These must all be done before touching any runtime code. They define the contract every other file depends on.

- [x] **A1.** In `lib/types.ts`, add `ProcessSource` type `{ title: string; url: string }`
- [x] **A2.** In `lib/types.ts`, add `ProcessStep` discriminated union (`kind: 'status' | 'tool'`, `status: 'active' | 'done' | 'error'`, optional `detail` and `sources` fields)
- [x] **A3.** In `lib/types.ts`, add `ProcessDataEvent` discriminated union (`kind: 'status' | 'tool-start' | 'tool-done' | 'tool-error'`, each with `id: string`)
- [x] **A4.** In `lib/types.ts`, update `AppDataTypes` from `{ process: { step: string } }` to `{ process: ProcessDataEvent }`

---

### Phase B — Context Layer

Depends on Phase A types being in place.

- [x] **B1.** In `lib/process-log-context.tsx`, update `ProcessLogContextType`: replace `steps: string[]` with `steps: ProcessStep[]`, replace `addStep(step: string)` with `addEvent(event: ProcessDataEvent)`
- [x] **B2.** In `lib/process-log-context.tsx`, update `ProcessLogProvider` state: `useState<ProcessStep[]>([])`
- [x] **B3.** In `lib/process-log-context.tsx`, implement `addEvent` with upsert logic:
  - `kind: 'status'` → append a new status step
  - `kind: 'tool-start'` → append a new tool step with `status: 'active'`
  - `kind: 'tool-done'` → find step by `id`, update label/status/detail/sources in place
  - `kind: 'tool-error'` → find step by `id`, update label/status to `'error'`
- [x] **B4.** In `lib/process-log-context.tsx`, update `useProcessLog` return type to match new `ProcessLogContextType`

---

### Phase C — ChatView Wiring

Depends on Phase B. Two-line change, but must compile cleanly before proceeding.

- [x] **C1.** In `components/ChatView.tsx`, replace `addStep, clearSteps` destructure with `addEvent, clearSteps` from `useProcessLog()`
- [x] **C2.** In `components/ChatView.tsx`, update `onData` handler: replace `addStep(dataPart.data.step)` with `addEvent(dataPart.data)`
- [x] **C3.** In `components/ChatView.tsx`, update `onFinish` "Done" call: replace `addStep("Done")` with `addEvent({ id: crypto.randomUUID(), kind: "status", label: "Done" })`
- [x] **C4.** Verify the app builds and the process log still renders (it'll show no steps yet since the route hasn't changed — that's expected)

---

### Phase D — Route Handler

Depends on Phase A types. The most complex phase — add all helper functions and the two new callbacks to `streamText`.

- [x] **D1.** In `app/api/route.ts`, add import for `stepCountIs` from `'ai'`
- [x] **D2.** In `app/api/route.ts`, add `eventId()` helper using `crypto.randomUUID()` as fallback
- [x] **D3.** In `app/api/route.ts`, add `toolStartLabel(toolName)` lookup table for all 8 tools
- [x] **D4.** In `app/api/route.ts`, add `toolDoneLabel(toolName)` lookup table for all 8 tools
- [x] **D5.** In `app/api/route.ts`, add `toolDetail(toolName, result)` function with a `switch` for each tool that extracts the most useful single-line summary from the tool's return value
- [x] **D6.** In `app/api/route.ts`, add `UrlCitation` type and `extractSources(responseMessages)` function that walks `response.messages` annotations for `url_citation` entries
- [x] **D7.** In `app/api/route.ts`, add `stopWhen: stepCountIs(10)` to the `streamText` call
- [x] **D8.** In `app/api/route.ts`, add `onChunk` callback to `streamText`: when `chunk.type === 'tool-call'`, emit `{ id: chunk.toolCallId, kind: 'tool-start', toolName, label }` via `writer.write()`
- [x] **D9.** In `app/api/route.ts`, add `onStepFinish` callback to `streamText`: for each item in `toolResults`, emit `{ id: tr.toolCallId, kind: 'tool-done', label, detail, sources }` via `writer.write()`. For `web_search_preview`, call `extractSources(response.messages)` to populate `sources`.
- [x] **D10.** In `app/api/route.ts`, update the initial `writer.write()` event from `{ step: 'Generating response...' }` to `{ id: crypto.randomUUID(), kind: 'status', label: 'Thinking...' }`
- [x] **D11.** Verify route compiles and test with a chat message — process log should show "Thinking..." then "Done"

---

### Phase E — Process Log Rendering

Depends on Phase B (context shape) and Phase D (events flowing). Do after D11 is verified.

- [x] **E1.** In `components/ProcessLog.tsx`, add `dotClass(step: ProcessStep)` helper that returns the correct CSS class string based on `step.status` (`dotActive` for active, `dotError` for error, plain `dot` for done)
- [x] **E2.** In `components/ProcessLog.tsx`, update the component to use `steps: ProcessStep[]` from `useProcessLog()` instead of `steps: string[]`
- [x] **E3.** In `components/ProcessLog.tsx`, update `steps.map()` to key on `step.id` instead of array index
- [x] **E4.** In `components/ProcessLog.tsx`, remove the `isInProgress` / `lastStepIndex` logic (no longer needed — status is on each step)
- [x] **E5.** In `components/ProcessLog.tsx`, render `step.detail` as a `<p className={styles.detail}>` below the event header, only when `step.kind === 'tool'` and `step.detail` is defined
- [x] **E6.** In `components/ProcessLog.tsx`, render `step.sources` as a `<ul className={styles.sources}>` with one `<li>` per source, each containing an `<a>` with `target="_blank" rel="noopener noreferrer"`, only when `step.kind === 'tool'` and `step.sources?.length > 0`
- [x] **E7.** In `components/ProcessLog.module.css`, add `.detail` rule (indented, tertiary color, 12px)
- [x] **E8.** In `components/ProcessLog.module.css`, add `.sources`, `.sourceItem`, `.sourceItem::before` (↳ glyph), `.sourceLink`, and `.sourceLink:hover` rules
- [x] **E9.** In `components/ProcessLog.module.css`, add `.dotError` rule (red background using `var(--error-primary)`)

---

### Phase F — Tool Implementations

The process log infrastructure is complete after Phase E. These tasks wire in the actual external API calls. Each tool is self-contained and can be built and tested independently.

- [x] **F1.** Create `lib/tools/get-coordinates.ts` — Nominatim `/search` fetch, `User-Agent` header, parse `lat`/`lon` as `parseFloat`, return `{ lat, lon, displayName }`
- [x] **F2.** Create `lib/tools/get-swell-forecast.ts` — Open-Meteo marine API fetch, `hourly` params for swell height/period/direction/SST, return the parsed JSON directly
- [x] **F3.** Create `lib/tools/get-wind-and-weather.ts` — Open-Meteo weather API fetch, `hourly` params for wind/temp/UV, `daily` for sunrise/sunset, return parsed JSON
- [x] **F4.** Create `lib/tools/get-tide-schedule.ts` — two-step NOAA CO-OPS: nearest station lookup then predictions fetch. Date params formatted as `YYYYMMDD`. Return `{ stationName, predictions: [{ t, v, type }] }`. Return a clear error string for non-US coordinates.
- [x] **F5.** Create `lib/tools/get-buoy-observations.ts` — NOAA NDBC text file fetch (server-side only, no CORS), whitespace-split parser, `MM`-safe `parseFloat` helper, return `{ waveHeight, dominantPeriod, meanWaveDirection, waterTemp, timestamp }`
- [x] **F6.** Create `lib/tools/get-destination-info.ts` — REST Countries `/name/{country}` fetch, `?fields=` to limit payload, return `{ name, currencyCode, currencySymbol, languages, timezone, capital }`
- [x] **F7.** Create `lib/tools/get-exchange-rate.ts` — Frankfurter primary with fawazahmed0 CDN fallback, lowercase key handling for fallback, return `{ rate, from, to, date, source }`
- [x] **F8.** Create `lib/tools/index.ts` — re-export all tools as a single `tools` object for the route handler. Include `web_search_preview: openai.tools.webSearchPreview({ searchContextSize: 'medium' })` here.
- [x] **F9.** In `app/api/route.ts`, import `tools` from `@/lib/tools` and add `tools` to the `streamText` call
- [x] **F10.** Switch route model from `openai("gpt-4o")` to `openai.responses("gpt-4o")` to enable `web_search_preview`
- [x] **F11.** Update `toolDetail()` in `app/api/route.ts` for each tool once the actual return shapes from F1–F7 are confirmed

---

### Phase G — System Prompt

- [x] **G1.** Rewrite system prompt in `app/api/route.ts` to include tool sequencing instructions: always call `get_coordinates` first, then swell/weather/tides in parallel if possible, then web search for logistics
- [x] **G2.** Add instructions for when to skip tools (e.g. no buoy for international spots, no tides for non-US locations)
- [x] **G3.** Add output format instructions: how to present the aggregated data in a readable, structured response
- [x] **G4.** Add derived output instructions: how to compute onshore/offshore classification, best session window, wetsuit recommendation, board recommendation, and daily budget estimate

---

### Phase H — Smoke Testing

- [ ] **H1.** Test a US surf spot (e.g. "Mavericks, CA next week") — verify all 7 tools fire in the process log, each transitions from active (amber) to done (green)
- [ ] **H2.** Test an international surf spot (e.g. "Uluwatu, Bali in June") — verify tide tool returns a graceful "not available" message, all other tools complete
- [ ] **H3.** Test web search — verify "Searching the web..." step resolves with source links, links are clickable and open correctly
- [ ] **H4.** Test a follow-up message in the same conversation — verify process log clears and re-runs from scratch
- [ ] **H5.** Test as a guest (not logged in) — verify process log works without authentication
- [ ] **H6.** Test error case — disconnect network mid-request, verify any active tool steps switch to error state and the chat recovers cleanly
