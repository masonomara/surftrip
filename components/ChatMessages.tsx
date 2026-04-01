"use client";

import { useEffect, useRef } from "react";
import { isTextUIPart } from "ai";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AppMessage } from "@/lib/types";
import styles from "./ChatMessages.module.css";

type Props = {
  messages: AppMessage[];
  isStreaming: boolean;
  error: Error | null;
};

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
    a: ({ ...props }) => (
      <a
        className={styles.mdA}
        target="_blank"
        rel="noopener noreferrer"
        {...props}
      />
    ),
    table: ({ ...props }) => (
      <div className={styles.mdTableWrap}>
        <table className={styles.mdTable} {...props} />
      </div>
    ),
    thead: ({ ...props }) => <thead {...props} />,
    th: ({ ...props }) => <th className={styles.mdTh} {...props} />,
    td: ({ ...props }) => <td className={styles.mdTd} {...props} />,
    hr: ({ ...props }) => <hr className={styles.mdHr} {...props} />,
    blockquote: ({ ...props }) => (
      <blockquote className={styles.mdBlockquote} {...props} />
    ),
    code: ({ className, children, ...props }) => {
      const isBlock = !className && String(children).includes("\n");
      return isBlock ? (
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

export default function ChatMessages({ messages, isStreaming, error }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className={styles.messages}>
      {messages.map((message) => {
        const textParts = message.parts.filter(isTextUIPart);
        if (textParts.length === 0) return null;
        const text = textParts.map((p) => p.text).join("");
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
                  {isStreaming && message === messages.at(-1) && (
                    <span className={styles.cursor}>▊</span>
                  )}
                </>
              ) : (
                <>
                  {text}
                  {isStreaming && message === messages.at(-1) && (
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

      <div ref={bottomRef} />
    </div>
  );
}
