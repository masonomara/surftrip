"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createConversation, loadConversations } from "@/lib/local-storage";

// ── Component ──────────────────────────────────────────────────────────────
//
// Renders nothing. Its only job is to redirect the guest user to a chat on
// mount: to the most recent conversation if one exists, or to a new one.
//
// This is a client component because localStorage is not available
// server-side, so this redirect can't happen in the page's Server Component.

export default function GuestHome() {
  const router = useRouter();

  useEffect(() => {
    const existingConversations = loadConversations();

    if (existingConversations.length > 0) {
      // Resume the most recent conversation (loadConversations returns them
      // sorted by updatedAt descending, so index 0 is the most recent).
      router.replace(`/chat/${existingConversations[0].id}`);
      return;
    }

    // No conversations yet — create one and navigate to it.
    const id = crypto.randomUUID();
    createConversation(id, "New conversation");
    window.dispatchEvent(new StorageEvent("storage")); // sync the sidebar
    router.replace(`/chat/${id}`);
  }, [router]);

  return null;
}
