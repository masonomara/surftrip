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
};

export default function ConversationSidebar({
  serverConversations,
  isAuthenticated,
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

  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>
        <span className={styles.logo}>Surftrip</span>
      </div>

      <nav className={styles.nav}>
        {conversations.map((c) => (
          <div key={c.id} className={styles.itemRow}>
            <Link
              href={`/chat/${c.id}`}
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
