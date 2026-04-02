"use client";

import { useEffect, useRef } from "react";
import { isTextUIPart } from "ai";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AppMessage } from "@/lib/types";
import { useToolCalls } from "@/lib/tool-calls-context";
import ThinkingIndicator from "./ThinkingIndicator";
import styles from "./ChatMessages.module.css";

// ── Markdown renderer overrides ────────────────────────────────────────────
//
// Each element gets a CSS module class so we can style markdown output without
// leaking global styles or fighting specificity wars.

const markdownComponents: React.ComponentProps<typeof Markdown>["components"] =
  {
    p: ({ ...props }) => <p className={styles.mdP} {...props} />,
    ul: ({ ...props }) => <ul className={styles.mdUl} {...props} />,
    ol: ({ ...props }) => <ol className={styles.mdOl} {...props} />,
    li: ({ ...props }) => <li className={styles.mdLi} {...props} />,
    h1: ({ ...props }) => <h1 className={styles.mdH1} {...props} />,
    h2: ({ ...props }) => <h2 className={styles.mdH2} {...props} />,
    h3: ({ ...props }) => <h3 className={styles.mdH3} {...props} />,
    h4: ({ ...props }) => <h3 className={styles.mdH4} {...props} />,
    strong: ({ ...props }) => <strong className={styles.mdStrong} {...props} />,
    em: ({ ...props }) => <em className={styles.mdEm} {...props} />,
    hr: ({ ...props }) => <hr className={styles.mdHr} {...props} />,
    blockquote: ({ ...props }) => (
      <blockquote className={styles.mdBlockquote} {...props} />
    ),
    th: ({ ...props }) => <th className={styles.mdTh} {...props} />,
    td: ({ ...props }) => <td className={styles.mdTd} {...props} />,

    // Links always open in a new tab. `noopener noreferrer` prevents the new
    // page from accessing `window.opener` (a phishing vector).
    a: ({ ...props }) => (
      <a
        className={styles.mdA}
        target="_blank"
        rel="noopener noreferrer"
        {...props}
      />
    ),

    // Tables need a scroll wrapper so they don't blow out the layout on mobile.
    table: ({ ...props }) => (
      <div className={styles.mdTableWrap}>
        <table className={styles.mdTable} {...props} />
      </div>
    ),

    // react-markdown passes a `className` of `language-xxx` on fenced code
    // blocks. Inline code has no className. We use this to decide whether to
    // render a <pre><code> block or just a plain <code> span.
    code: ({ className, children, ...props }) => {
      const isFencedBlock =
        Boolean(className) || String(children).includes("\n");
      return isFencedBlock ? (
        <pre className={styles.mdPre}>
          <code {...props}>{children}</code>
        </pre>
      ) : (
        <code className={styles.mdCode} {...props}>
          {children}
        </code>
      );
    },
  };

// ── Types ──────────────────────────────────────────────────────────────────

type Props = {
  messages: AppMessage[];
  isActive: boolean;
  error: Error | null;
};

// ── Component ──────────────────────────────────────────────────────────────

export default function ChatMessages({ messages, isActive, error }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const { steps, openPanel } = useToolCalls();

  // Last active step drives the animated indicator label.
  const lastActiveStep = isActive
    ? ([...steps].reverse().find((s) => s.status === "active") ?? null)
    : null;

  // Hide the animated indicator once the assistant starts outputting text.
  const lastMessage = messages.at(-1);
  const lastAssistantHasText =
    lastMessage?.role === "assistant" &&
    lastMessage.parts
      .filter(isTextUIPart)
      .map((p) => p.text)
      .join("").length > 0;

  // Build "View buoy data, swell forecast" label from completed tool steps.
  const TOOL_LABELS: Record<string, string> = {
    get_coordinates: "location",
    get_swell_forecast: "swell forecast",
    get_wind_and_weather: "wind & weather",
    get_tide_schedule: "tides",
    get_buoy_observations: "buoy data",
    get_destination_info: "destination info",
    get_exchange_rate: "exchange rate",
    web_search_preview: "web search",
  };
  const completedLabels = [
    ...new Set(
      steps
        .filter((s) => s.kind === "tool" && s.status === "done")
        .map((s) =>
          s.kind === "tool" ? (TOOL_LABELS[s.toolName] ?? s.toolName) : "",
        )
        .filter(Boolean),
    ),
  ];
  const viewLabel =
    completedLabels.length === 0
      ? ""
      : completedLabels.length <= 3
        ? `View ${completedLabels.join(", ")}`
        : `View ${completedLabels.slice(0, 2).join(", ")} +${completedLabels.length - 2} more`;

  // Scroll to the bottom whenever a new message arrives or content streams in.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isActive]);

  if (messages.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.title}>Where are you headed?</p>
        <p className={styles.hint}>
          Drop a destination for conditions, breaks, and logistics.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.messages}>
      {messages.map((message) => {
        // A message can contain multiple parts (text, tool calls, etc.).
        // We only render text parts here; tool call details are shown in the
        // ToolCalls panel.
        const text = message.parts
          .filter(isTextUIPart)
          .map((part) => part.text)
          .join("");

        if (!text) return null;

        return (
          <div
            key={message.id}
            className={`${styles.message} ${styles[message.role]}`}
          >
            <div className={styles.bubble}>
              {message.role === "assistant" ? (
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  components={markdownComponents}
                >
                  {text}
                </Markdown>
              ) : (
                text
              )}
            </div>
          </div>
        );
      })}

      {/* Animated indicator — while tools run, before assistant text appears */}
      {isActive && lastActiveStep !== null && !lastAssistantHasText && (
        <div className={styles.message}>
          <ThinkingIndicator
            mode="active"
            label={lastActiveStep.label}
            onClick={openPanel}
          />
        </div>
      )}

      {/* Complete indicator — only after response is fully done */}
      {!isActive && viewLabel && (
        <div className={styles.message}>
          <ThinkingIndicator
            mode="complete"
            label={viewLabel}
            onClick={openPanel}
          />
        </div>
      )}

      {error && (
        <div className={styles.error}>
          Something went wrong. Please try again.
        </div>
      )}

      {/* Scroll anchor — scrollIntoView targets this invisible div */}
      <div ref={bottomRef} />
    </div>
  );
}
