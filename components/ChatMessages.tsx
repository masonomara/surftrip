"use client";

import { useEffect, useRef } from "react";
import { isTextUIPart } from "ai";
import type { AppMessage } from "@/lib/types";
import styles from "./ChatMessages.module.css";

type Props = {
  messages: AppMessage[];
  isStreaming: boolean;
  error: Error | null;
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
        return (
          <div
            key={message.id}
            className={`${styles.message} ${styles[message.role]}`}
          >
            <div className={styles.bubble}>
              {textParts.map((part, i) => (
                <span key={i} className={styles.text}>
                  {part.text}
                </span>
              ))}
              {isStreaming &&
                message.role === "assistant" &&
                message === messages.at(-1) && (
                  <span className={styles.cursor}>▊</span>
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
