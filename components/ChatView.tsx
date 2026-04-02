"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isTextUIPart } from "ai";
import { createClient } from "@/lib/supabase/client";
import { useProcessLog } from "@/lib/process-log-context";
import {
  loadConversation,
  appendMessages,
  updateTitle,
  clearConversationMessages,
} from "@/lib/local-storage";
import ChatMessages from "@/components/ChatMessages";
import ChatInput from "@/components/ChatInput";
import type { AppMessage, LocalMessage } from "@/lib/types";
import styles from "./ChatView.module.css";

// ── Helpers ────────────────────────────────────────────────────────────────

// Extract the plain text content from a message. A message can have multiple
// parts (text, tool calls, etc.); we only care about the text ones here.
function extractText(message: AppMessage): string {
  return message.parts
    .filter(isTextUIPart)
    .map((part) => part.text)
    .join("");
}

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
  const router = useRouter();
  const { addEvent, clearSteps } = useProcessLog();

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
        // The route handler streams process steps as data-process events so we
        // can show them in the ProcessLog panel without blocking the text stream.
        if (dataPart.type === "data-process") {
          addEvent(dataPart.data);
        }
      },

      onFinish: ({ messages: finishedMessages }) => {
        // "Done" is the label that process-log-context uses to mark a status
        // step as completed (status: "done") rather than active.
        addEvent({ id: crypto.randomUUID(), kind: "status", label: "Done" });

        if (isAuthenticated) {
          // Authenticated: Supabase has already persisted messages server-side
          // via the route handler. We only need to revalidate the sidebar.
          router.refresh();
          return;
        }

        // Guest: we persist the last exchange (one user + one assistant message)
        // to localStorage ourselves, since there's no server to do it for us.
        const lastUserMessage      = finishedMessages.findLast((m) => m.role === "user");
        const lastAssistantMessage = finishedMessages.findLast((m) => m.role === "assistant");

        const messagesToSave: LocalMessage[] = [];

        if (lastUserMessage) {
          messagesToSave.push({
            id:        lastUserMessage.id,
            role:      "user",
            content:   extractText(lastUserMessage),
            createdAt: new Date().toISOString(),
          });
        }

        if (lastAssistantMessage) {
          messagesToSave.push({
            id:        lastAssistantMessage.id,
            role:      "assistant",
            content:   extractText(lastAssistantMessage),
            createdAt: new Date().toISOString(),
          });
        }

        appendMessages(chatId, messagesToSave);

        // Set the conversation title from the first user message, truncated to
        // 60 chars. We only do this once (when there's exactly one user message)
        // so we don't overwrite a title the user might have set later.
        const userMessageCount = finishedMessages.filter((m) => m.role === "user").length;
        const isFirstMessage   = userMessageCount === 1 && lastUserMessage;

        if (isFirstMessage) {
          const raw   = extractText(lastUserMessage);
          const title = raw.length > 60 ? raw.slice(0, 60) + "..." : raw;
          updateTitle(chatId, title);
        }

        // Notify the ConversationSidebar (which listens to the storage event)
        // to re-render with the new message/title, then revalidate server data.
        window.dispatchEvent(new StorageEvent("storage"));
        router.refresh();
      },
    });

  // For guest users, initialMessages comes from the server as an empty array
  // (the server has no knowledge of localStorage). We load the real history
  // from localStorage on the client after mount.
  useEffect(() => {
    if (isAuthenticated) return;

    const stored = loadConversation(chatId);
    if (!stored || stored.messages.length === 0) return;

    setMessages(
      stored.messages.map((m) => ({
        id:        m.id,
        role:      m.role,
        parts:     [{ type: "text" as const, text: m.content }],
        createdAt: new Date(m.createdAt),
      })),
    );
  }, [chatId, isAuthenticated, setMessages]);

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
        isStreaming={status === "streaming"}
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
