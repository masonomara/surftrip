"use client";

import { useEffect, useRef } from "react";
import styles from "./ChatInput.module.css";
import { Send } from "lucide-react";

// ── Constants ──────────────────────────────────────────────────────────────

// Must match the `maxLength` attribute on the textarea below.
const MAX_LENGTH = 10_000;

// ── Types ──────────────────────────────────────────────────────────────────

type Props = {
  onSend: (text: string) => void;
  onStop: () => void;
  onClear: () => void;
  isActive: boolean; // true while a response is streaming
};

// ── Component ──────────────────────────────────────────────────────────────

export default function ChatInput({
  onSend,
  onStop,
  onClear,
  isActive,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // We track the textarea value in a ref instead of useState to avoid
  // re-rendering the whole component on every keystroke. The textarea is
  // uncontrolled; we only read the value at submit time.
  const valueRef = useRef("");

  // Shrink/grow the textarea to fit its content, up to 200px tall.
  function autoResize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    valueRef.current = e.target.value;
    autoResize();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter alone submits. Shift+Enter inserts a newline (default behavior).
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleSubmit() {
    const text = valueRef.current.trim();

    // The textarea's maxLength attribute enforces the limit in the DOM, but we
    // guard here too in case this is called programmatically.
    if (!text || isActive || text.length > MAX_LENGTH) return;

    onSend(text);

    // Clear the textarea and collapse it back to one row.
    if (textareaRef.current) {
      textareaRef.current.value = "";
      valueRef.current = "";
      autoResize();
    }
  }

  // Return focus to the textarea once streaming finishes so the user can type
  // their next message without clicking.
  useEffect(() => {
    if (!isActive) {
      textareaRef.current?.focus();
    }
  }, [isActive]);

  // ── Render ───────────────────────────────────────────────────────────────

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
              <button
                onClick={onStop}
                className={styles.stopButton}
                type="button"
              >
                Stop
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                className={styles.sendButton}
                type="button"
                aria-label="Send"
              >
                <Send size={14} aria-hidden="true" />
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
