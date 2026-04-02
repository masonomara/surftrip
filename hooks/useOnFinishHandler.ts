"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { appendMessages, updateTitle } from "@/lib/local-storage";
import { extractText } from "@/lib/utils";
import type { AppMessage, LocalMessage, ProcessDataEvent } from "@/lib/types";

type Params = {
  chatId: string;
  isAuthenticated: boolean;
  addEvent: (event: ProcessDataEvent) => void;
};

// Returns the `onFinish` callback for `useChat`. Handles the "Done" status
// event, and persists the last exchange to localStorage for guest users.
export function useOnFinishHandler({
  chatId,
  isAuthenticated,
  addEvent,
}: Params): (result: { messages: AppMessage[] }) => void {
  const router = useRouter();

  return useCallback(
    ({ messages: finishedMessages }) => {
      // "Done" marks the final status step as completed so the ThinkingIndicator
      // knows to stop showing.
      addEvent({ id: crypto.randomUUID(), kind: "status", label: "Done" });

      if (isAuthenticated) {
        // Authenticated: Supabase has already persisted messages server-side
        // via the route handler. We only need to revalidate the sidebar.
        router.refresh();
        return;
      }

      // Guest: we persist the last exchange (one user + one assistant message)
      // to localStorage ourselves, since there's no server to do it for us.
      const lastUserMessage = finishedMessages.findLast(
        (m) => m.role === "user",
      );
      const lastAssistantMessage = finishedMessages.findLast(
        (m) => m.role === "assistant",
      );

      const messagesToSave: LocalMessage[] = [];

      if (lastUserMessage) {
        messagesToSave.push({
          id: lastUserMessage.id,
          role: "user",
          content: extractText(lastUserMessage),
          createdAt: new Date().toISOString(),
        });
      }

      if (lastAssistantMessage) {
        messagesToSave.push({
          id: lastAssistantMessage.id,
          role: "assistant",
          content: extractText(lastAssistantMessage),
          createdAt: new Date().toISOString(),
        });
      }

      appendMessages(chatId, messagesToSave);

      // Set the conversation title from the first user message, truncated to
      // 60 chars. We only do this once (when there's exactly one user message)
      // so we don't overwrite a title the user might have set later.
      const userMessageCount = finishedMessages.filter(
        (m) => m.role === "user",
      ).length;
      const isFirstMessage = userMessageCount === 1 && lastUserMessage;

      if (isFirstMessage) {
        const raw = extractText(lastUserMessage);
        const title = raw.length > 60 ? raw.slice(0, 60) + "..." : raw;
        updateTitle(chatId, title);
      }

      // Notify the ConversationSidebar (which listens to the storage event)
      // to re-render with the new message/title, then revalidate server data.
      window.dispatchEvent(new StorageEvent("storage"));
      router.refresh();
    },
    [chatId, isAuthenticated, addEvent, router],
  );
}
