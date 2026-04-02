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

      const messagesToSave: LocalMessage[] = [
        lastUserMessage,
        lastAssistantMessage,
      ]
        .filter((m): m is AppMessage => m !== undefined)
        .map((m) => ({
          id: m.id,
          role: m.role as LocalMessage["role"],
          content: extractText(m),
          createdAt: new Date().toISOString(),
        }));

      appendMessages(chatId, messagesToSave);

      // Set the title from the first user message, truncated to 60 chars.
      // Only done once so subsequent exchanges don't overwrite it.
      const userMessageCount = finishedMessages.filter(
        (m) => m.role === "user",
      ).length;

      if (userMessageCount === 1 && lastUserMessage) {
        const raw = extractText(lastUserMessage);
        updateTitle(chatId, raw.length > 60 ? raw.slice(0, 60) + "..." : raw);
      }

      // Notify the ConversationSidebar (which listens to the storage event)
      // to re-render with the new message/title, then revalidate server data.
      window.dispatchEvent(new StorageEvent("storage"));
      router.refresh();
    },
    [chatId, isAuthenticated, addEvent, router],
  );
}
