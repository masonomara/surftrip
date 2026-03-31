"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createConversation, loadConversations } from "@/lib/local-storage";

export default function GuestHome() {
  const router = useRouter();

  useEffect(() => {
    const existing = loadConversations();
    if (existing.length > 0) {
      router.replace(`/chat/${existing[0].id}`);
      return;
    }

    const id = crypto.randomUUID();
    createConversation(id, "New conversation");
    router.replace(`/chat/${id}`);
  }, [router]);

  return null;
}
