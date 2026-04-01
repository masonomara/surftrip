"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isTextUIPart } from "ai";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
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
import type { AppMessage } from "@/lib/types";
import styles from "@/components/ChatView.module.css";

type Props = {
  chatId: string;
  initialMessages: AppMessage[];
  isAuthenticated: boolean;
};

export default function ChatView({
  chatId,
  initialMessages,
  isAuthenticated,
}: Props) {
  const router = useRouter();
  const { addStep, clearSteps } = useProcessLog();

  const { messages, sendMessage, setMessages, status, stop, error } =
    useChat<AppMessage>({
      transport: new DefaultChatTransport({
        api: "/api",
        prepareSendMessagesRequest: ({ messages }) => ({
          body: { messages, chatId },
        }),
      }),
      messages: initialMessages,
      onData: (dataPart) => {
        if (dataPart.type === "data-process") {
          addStep(dataPart.data.step);
        }
      },
      onFinish: ({ messages: finishedMessages }) => {
        addStep("Done");
        if (!isAuthenticated) {
          const lastUser = finishedMessages.findLast((m) => m.role === "user");
          const lastAssistant = finishedMessages.findLast(
            (m) => m.role === "assistant",
          );

          function extractText(msg: AppMessage): string {
            return msg.parts
              .filter(isTextUIPart)
              .map((p) => p.text)
              .join("");
          }

          const toSave = [];
          if (lastUser)
            toSave.push({
              id: lastUser.id,
              role: "user" as const,
              content: extractText(lastUser),
              createdAt: new Date().toISOString(),
            });
          if (lastAssistant)
            toSave.push({
              id: lastAssistant.id,
              role: "assistant" as const,
              content: extractText(lastAssistant),
              createdAt: new Date().toISOString(),
            });

          appendMessages(chatId, toSave);

          if (
            finishedMessages.filter((m) => m.role === "user").length === 1 &&
            lastUser
          ) {
            const raw = extractText(lastUser);
            const title = raw.slice(0, 60) + (raw.length > 60 ? "..." : "");
            updateTitle(chatId, title);
          }

          window.dispatchEvent(new StorageEvent("storage"));
          router.refresh();
        } else {
          router.refresh();
        }
      },
    });

  useEffect(() => {
    if (isAuthenticated) return;
    const stored = loadConversation(chatId);
    if (stored && stored.messages.length > 0) {
      setMessages(
        stored.messages.map((m) => ({
          id: m.id,
          role: m.role,
          parts: [{ type: "text" as const, text: m.content }],
          createdAt: new Date(m.createdAt),
        })),
      );
    }
  }, [chatId, isAuthenticated, setMessages]);

  function handleSend(text: string) {
    clearSteps();
    sendMessage({ text });
  }

  async function handleClear() {
    if (!isAuthenticated) {
      clearConversationMessages(chatId);
      setMessages([]);
    } else {
      const supabase = createClient();
      await supabase.from("messages").delete().eq("conversation_id", chatId);
      setMessages([]);
    }
  }

  const isActive = status === "submitted" || status === "streaming";

  return (
    <div className={styles.chat}>
      <ChatMessages
        messages={messages}
        isStreaming={status === "streaming"}
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
