"use client";

import { useEffect, useRef } from "react";
import { isTextUIPart } from "ai";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AppMessage } from "@/lib/types";
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
  isStreaming: boolean;
  error: Error | null;
};

// ── Component ──────────────────────────────────────────────────────────────

export default function ChatMessages({ messages, isStreaming, error }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Scroll to the bottom whenever a new message arrives or content streams in.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  if (messages.length === 0) {
    return (
      <div className={styles.empty}>
        <p>Where are you headed?</p>
        <p className={styles.hint}>
          Describe a destination and travel dates to get started.
        </p>
      </div>
    );
  }

  const lastMessage = messages.at(-1);

  return (
    <div className={styles.messages}>
      {messages.map((message) => {
        // A message can contain multiple parts (text, tool calls, etc.).
        // We only render text parts here; everything else is shown in the
        // ProcessLog panel.
        const text = message.parts
          .filter(isTextUIPart)
          .map((part) => part.text)
          .join("");

        if (!text) return null;

        // Show the blinking cursor on the last message while it's streaming.
        const showStreamingCursor = isStreaming && message === lastMessage;

        return (
          <div
            key={message.id}
            className={`${styles.message} ${styles[message.role]}`}
          >
            <div className={styles.bubble}>
              {message.role === "assistant" ? (
                <>
                  <Markdown
                    remarkPlugins={[remarkGfm]}
                    components={markdownComponents}
                  >
                    {text}
                  </Markdown>
                  {showStreamingCursor && (
                    <span className={styles.cursor}>▊</span>
                  )}
                </>
              ) : (
                <>
                  {text}
                  {showStreamingCursor && (
                    <span className={styles.cursor}>▊</span>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}

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
