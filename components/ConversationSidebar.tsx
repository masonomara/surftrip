"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { loadConversations, deleteConversation } from "@/lib/local-storage";
import type { Tables } from "@/lib/types";
import styles from "./ConversationSidebar.module.css";

type ConversationSummary = Pick<
  Tables<"conversations">,
  "id" | "title" | "updated_at"
>;

type Props = {
  serverConversations: ConversationSummary[];
  isAuthenticated: boolean;
  onClose?: () => void;
};

export default function ConversationSidebar({
  serverConversations,
  isAuthenticated,
  onClose,
}: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [localConversations, setLocalConversations] = useState<ConversationSummary[]>([]);
  const conversations = isAuthenticated ? serverConversations : localConversations;

  const currentChatId = pathname.startsWith("/chat/") ? pathname.slice(6) : null;

  useEffect(() => {
    if (isAuthenticated) return;

    function sync() {
      const stored = loadConversations();
      setLocalConversations(
        stored.map((c) => ({
          id: c.id,
          title: c.title,
          updated_at: c.updatedAt,
        })),
      );
    }

    sync();
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [isAuthenticated]);

  async function handleDeleteConversation(id: string) {
    if (isAuthenticated) {
      const supabase = createClient();
      await supabase.from("conversations").delete().eq("id", id);
      if (id === currentChatId) router.push("/");
      router.refresh();
    } else {
      deleteConversation(id);
      setLocalConversations((prev) => prev.filter((c) => c.id !== id));
      window.dispatchEvent(new StorageEvent("storage"));
      if (id === currentChatId) router.push("/");
    }
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  async function handleNewChat() {
    onClose?.();
    if (isAuthenticated) {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("conversations")
        .insert({ title: "New conversation", user_id: user.id })
        .select("id")
        .single();
      if (data) {
        router.push(`/chat/${data.id}`);
        router.refresh();
      }
    } else {
      const id = crypto.randomUUID();
      const { createConversation } = await import("@/lib/local-storage");
      createConversation(id, "New conversation");
      window.dispatchEvent(new StorageEvent("storage"));
      router.push(`/chat/${id}`);
    }
  }

  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>
        {onClose ? (
          <button
            onClick={onClose}
            className={styles.hideBtn}
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M10.5 3.5 6 8l4.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Hide
          </button>
        ) : (
          <span className={styles.logo}>Surftrip</span>
        )}
        <button
          onClick={handleNewChat}
          className={styles.newChatBtn}
          type="button"
          aria-label="New chat"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 2.5a.75.75 0 0 1 .75.75v4h4a.75.75 0 0 1 0 1.5h-4v4a.75.75 0 0 1-1.5 0v-4h-4a.75.75 0 0 1 0-1.5h4v-4A.75.75 0 0 1 8 2.5Z" fill="currentColor"/>
          </svg>
          New chat
        </button>
      </div>

      <div className={styles.sectionLabel}>Your chats</div>

      <nav className={styles.nav}>
        {conversations.map((c) => (
          <div key={c.id} className={styles.itemRow}>
            <Link
              href={`/chat/${c.id}`}
              onClick={onClose}
              className={`${styles.item} ${
                pathname === `/chat/${c.id}` ? styles.active : ""
              }`}
            >
              {c.title}
            </Link>
            <button
              onClick={() => handleDeleteConversation(c.id)}
              className={styles.deleteBtn}
              type="button"
              aria-label="Delete conversation"
            >
              ×
            </button>
          </div>
        ))}
      </nav>

      <div className={styles.footer}>
        {isAuthenticated ? (
          <button onClick={handleSignOut} className={styles.signOut}>
            Sign out
          </button>
        ) : (
          <Link href="/login" className={styles.signIn}>
            Sign in to sync across devices
          </Link>
        )}
      </div>
    </aside>
  );
}
