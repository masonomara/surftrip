"use client";

import { useRef, useEffect } from "react";
import styles from "./ChatInput.module.css";

const MAX_LENGTH = 10_000;

type Props = {
  onSend: (text: string) => void;
  onStop: () => void;
  onClear: () => void;
  isActive: boolean;
};

export default function ChatInput({ onSend, onStop, onClear, isActive }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const valueRef = useRef("");

  function resize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    valueRef.current = e.target.value;
    resize();
  }

  function submit() {
    const text = valueRef.current.trim();
    if (!text || isActive || text.length > MAX_LENGTH) return;
    onSend(text);
    if (textareaRef.current) {
      textareaRef.current.value = "";
      valueRef.current = "";
      resize();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  useEffect(() => {
    if (!isActive) {
      textareaRef.current?.focus();
    }
  }, [isActive]);

  return (
    <div className={styles.container}>
      <div className={styles.inputRow}>
        <textarea
          ref={textareaRef}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Ask about a surf destination..."
          disabled={isActive}
          rows={1}
          maxLength={MAX_LENGTH}
          className={styles.textarea}
        />
        {isActive ? (
          <button onClick={onStop} className={styles.stopButton} type="button">
            Stop
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={isActive}
            className={styles.sendButton}
            type="button"
          >
            Send
          </button>
        )}
      </div>
      <div className={styles.actions}>
        <button
          onClick={onClear}
          disabled={isActive}
          className={styles.clearButton}
          type="button"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
