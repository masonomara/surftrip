"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocalConversations } from "@/hooks/useLocalConversations";
import { useConversations } from "@/hooks/useConversations";
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

  // Guest users get conversations from localStorage; authenticated users get
  // them from the server (passed in as a prop, already fetched server-side).
  const localConversations = useLocalConversations(isAuthenticated);
  const conversations = isAuthenticated ? serverConversations : localConversations;

  const activeChatId = pathname.startsWith("/chat/") ? pathname.slice(6) : null;

  const { handleNewChat, handleDeleteConversation, handleSignOut } =
    useConversations({ isAuthenticated, activeChatId, onClose });

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
            className={`${styles.itemRow} ${activeChatId === conversation.id ? styles.active : ""}`}
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

      {process.env.NEXT_PUBLIC_SUPABASE_URL && (
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
      )}
    </aside>
  );
}
