"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { createClient } from "@/lib/supabase/client";
import { useToolCall } from "@/lib/tool-call-context";
import { clearConversationMessages } from "@/lib/local-storage";
import { useLocalMessages } from "@/hooks/useLocalMessages";
import { useOnFinishHandler } from "@/hooks/useOnFinishHandler";
import ChatMessages from "@/components/ChatMessages";
import ChatInput from "@/components/ChatInput";
import type { AppMessage } from "@/lib/types";
import styles from "./ChatView.module.css";

// ── Types ──────────────────────────────────────────────────────────────────

type Props = {
  chatId: string;
  initialMessages: AppMessage[];
  isAuthenticated: boolean;
};

// ── Component ──────────────────────────────────────────────────────────────

export default function ChatView({
  chatId,
  initialMessages,
  isAuthenticated,
}: Props) {
  const { addEvent, clearSteps } = useToolCall();

  const onFinish = useOnFinishHandler({ chatId, isAuthenticated, addEvent });

  const { messages, sendMessage, setMessages, status, stop, error } =
    useChat<AppMessage>({
      transport: new DefaultChatTransport({
        api: "/api",
        // chatId tells the route handler which conversation to append messages
        // to. It's sent in the body rather than the URL so we can use a single
        // /api route instead of /api/[chatId].
        prepareSendMessagesRequest: ({ messages }) => ({
          body: { messages, chatId },
        }),
      }),
      messages: initialMessages,

      onData: (dataPart) => {
        // The route handler streams tool call events as data-process events so we
        // can show them in the ToolCalls panel without blocking the text stream.
        if (dataPart.type === "data-process") {
          addEvent(dataPart.data);
        }
      },

      onFinish,
    });

  useLocalMessages(chatId, isAuthenticated, setMessages);

  // ── Handlers ────────────────────────────────────────────────────────────

  function handleSend(text: string) {
    clearSteps();
    sendMessage({ text });
  }

  async function handleClear() {
    if (isAuthenticated) {
      const supabase = createClient();
      await supabase.from("messages").delete().eq("conversation_id", chatId);
    } else {
      clearConversationMessages(chatId);
    }
    setMessages([]);
  }

  // "active" means a request has been sent and we're waiting for or receiving
  // a response. The input is disabled and the Stop button is shown during this.
  const isActive = status === "submitted" || status === "streaming";

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className={styles.chat}>
      <ChatMessages
        messages={messages}
        isActive={isActive}
        error={error ?? null}
      />
      <ChatInput
        onSend={handleSend}
        onStop={stop}
        onClear={handleClear}
        isActive={isActive}
      />
    </div>
  );
}
