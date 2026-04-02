"use client";

import { useEffect } from "react";
import { loadConversation } from "@/lib/local-storage";
import type { AppMessage } from "@/lib/types";

// For guest users, the server has no knowledge of localStorage so
// `initialMessages` arrives as an empty array. This hook loads the real
// history from localStorage on the client after mount and hydrates the
// chat state via `setMessages`.
export function useLocalMessages(
  chatId: string,
  isAuthenticated: boolean,
  setMessages: (messages: AppMessage[]) => void,
): void {
  useEffect(() => {
    if (isAuthenticated) return;

    const stored = loadConversation(chatId);
    if (!stored || stored.messages.length === 0) return;

    setMessages(
      stored.messages.map((m) => ({
        id: m.id,
        role: m.role,
        parts: [{ type: "text" as const, text: m.content }],
        createdAt: new Date(m.createdAt),
      })),
    );
  }, [chatId, isAuthenticated, setMessages]);
}
