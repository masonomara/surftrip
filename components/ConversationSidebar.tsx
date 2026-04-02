"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  createConversation,
  loadConversations,
  deleteConversation,
} from "@/lib/local-storage";
import type { ConversationSummary } from "@/lib/types";
import styles from "./ConversationSidebar.module.css";
import {
  X,
  CircleUserRound,
  LogOut,
  SquarePen,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

type Props = {
  serverConversations: ConversationSummary[];
  isAuthenticated: boolean;
  onClose?: () => void;
};

// ── Component ──────────────────────────────────────────────────────────────

export default function ConversationSidebar({
  serverConversations,
  isAuthenticated,
  onClose,
}: Props) {
  const pathname = usePathname();
  const router = useRouter();

  // Guest users get conversations from localStorage; authenticated users get
  // them from the server (passed in as a prop, already fetched server-side).
  const [localConversations, setLocalConversations] = useState<
    ConversationSummary[]
  >([]);
  const conversations = isAuthenticated
    ? serverConversations
    : localConversations;

  const activeChatId = pathname.startsWith("/chat/") ? pathname.slice(6) : null;

  // Keep local conversations in sync with localStorage across tabs.
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

  // ── Handlers ────────────────────────────────────────────────────────────

  async function handleNewChat() {
    onClose?.();

    if (isAuthenticated) {
      await createAuthenticatedConversation();
    } else {
      createGuestConversation();
    }
  }

  async function createAuthenticatedConversation() {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

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
  }

  function createGuestConversation() {
    const id = crypto.randomUUID();
    createConversation(id, "New conversation");
    window.dispatchEvent(new StorageEvent("storage"));
    router.push(`/chat/${id}`);
  }

  async function handleDeleteConversation(id: string) {
    if (isAuthenticated) {
      const supabase = createClient();
      await supabase.from("conversations").delete().eq("id", id);
      router.refresh();
    } else {
      deleteConversation(id);
      setLocalConversations((prev) =>
        prev.filter((conversation) => conversation.id !== id),
      );
      window.dispatchEvent(new StorageEvent("storage"));
    }

    // Navigate away if the deleted conversation is the one currently open.
    if (id === activeChatId) {
      router.push("/");
    }
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>
        {onClose ? (
          <button onClick={onClose} className={styles.hideBtn} type="button">
            <LogOut
              style={{ transform: "rotate(180deg)" }}
              size={18}
              strokeWidth={1.75}
              aria-hidden="true"
            />
            Close
          </button>
        ) : (
          <span className={styles.logo}>Surftrip</span>
        )}
      </div>
      <button
        onClick={handleNewChat}
        className={styles.newChatBtn}
        type="button"
        aria-label="New chat"
      >
        <SquarePen size={18} strokeWidth={1.75} aria-hidden="true" />
        New chat
      </button>
      <div className={styles.sectionLabel}>Your chats</div>

      <nav className={styles.nav}>
        {conversations.map((conversation) => (
          <div
            key={conversation.id}
            className={`${styles.itemRow} ${
              pathname === `/chat/${conversation.id}` ? styles.active : ""
            }`}
          >
            <Link
              href={`/chat/${conversation.id}`}
              onClick={onClose}
              className={styles.item}
            >
              {conversation.title}
            </Link>

            <button
              onClick={() => handleDeleteConversation(conversation.id)}
              className={styles.deleteBtn}
              type="button"
              aria-label="Delete conversation"
            >
              <X size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        ))}
      </nav>

      <div className={styles.footer}>
        {isAuthenticated ? (
          <button
            onClick={handleSignOut}
            className={styles.signOut}
            type="button"
          >
            <CircleUserRound size={18} strokeWidth={1.75} aria-hidden="true" />
            Sign out
          </button>
        ) : (
          <Link href="/login" className={styles.signIn}>
            <CircleUserRound size={18} strokeWidth={1.75} aria-hidden="true" />
            Sign in
          </Link>
        )}
      </div>
    </aside>
  );
}
