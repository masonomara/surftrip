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
    <div className={styles.wrapper}>
      <div className={styles.inputArea}>
        <div className={styles.inputWrap}>
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
          <div className={styles.bottomRow}>
            <button
              onClick={onClear}
              disabled={isActive}
              className={styles.clearButton}
              type="button"
            >
              Clear
            </button>
            {isActive ? (
              <button onClick={onStop} className={styles.stopButton} type="button">
                Stop
              </button>
            ) : (
              <button
                onClick={submit}
                className={styles.sendButton}
                type="button"
                aria-label="Send"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
      <p className={styles.note}>
        Surftrip may make mistakes. Verify conditions before you paddle out.
      </p>
    </div>
  );
}
