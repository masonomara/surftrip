"use client";

import { useState, useEffect } from "react";
import { loadConversations } from "@/lib/local-storage";
import type { ConversationSummary } from "@/lib/types";

// Keeps a list of guest conversations in sync with localStorage across tabs.
// Returns an empty array for authenticated users (they get conversations from
// the server instead).
export function useLocalConversations(
  isAuthenticated: boolean,
): ConversationSummary[] {
  const [localConversations, setLocalConversations] = useState<
    ConversationSummary[]
  >([]);

  useEffect(() => {
    if (isAuthenticated) return;

    function syncFromStorage() {
      const stored = loadConversations();
      setLocalConversations(
        stored.map((conversation) => ({
          id: conversation.id,
          title: conversation.title,
          updated_at: conversation.updatedAt,
        })),
      );
    }

    syncFromStorage();
    window.addEventListener("storage", syncFromStorage);
    return () => window.removeEventListener("storage", syncFromStorage);
  }, [isAuthenticated]);

  return localConversations;
}
