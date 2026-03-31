"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { loadConversations, createConversation } from "@/lib/local-storage";
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
  const [conversations, setConversations] =
    useState<ConversationSummary[]>(serverConversations);

  useEffect(() => {
    if (isAuthenticated) return;

    function sync() {
      const stored = loadConversations();
      setConversations(
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

  async function handleNewChat() {
    if (isAuthenticated) {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from("conversations")
        .insert({ user_id: user.id, title: "New conversation" })
        .select("id")
        .single();

      if (data) {
        router.push(`/chat/${data.id}`);
        router.refresh();
      }
    } else {
      const id = crypto.randomUUID();
      createConversation(id, "New conversation");
      setConversations((prev) => [
        { id, title: "New conversation", updated_at: new Date().toISOString() },
        ...prev,
      ]);
      router.push(`/chat/${id}`);
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
        <button onClick={handleNewChat} className={styles.newChat}>
          New chat
        </button>
      </div>

      <nav className={styles.nav}>
        {conversations.map((c) => (
          <Link
            key={c.id}
            href={`/chat/${c.id}`}
            className={`${styles.item} ${
              pathname === `/chat/${c.id}` ? styles.active : ""
            }`}
          >
            {c.title}
          </Link>
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
