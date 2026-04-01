import type { LocalConversation, LocalMessage } from "@/lib/types";

const KEY = "surftrip_conversations";

// ── Read ───────────────────────────────────────────────────────────────────

export function loadConversations(): LocalConversation[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function loadConversation(id: string): LocalConversation | null {
  return loadConversations().find((c) => c.id === id) ?? null;
}

// ── Write ──────────────────────────────────────────────────────────────────

function persist(conversations: LocalConversation[]): void {
  localStorage.setItem(KEY, JSON.stringify(conversations));
}

export function createConversation(
  id: string,
  title: string,
): LocalConversation {
  const conv: LocalConversation = {
    id,
    title,
    updatedAt: new Date().toISOString(),
    messages: [],
  };
  // Prepend so the newest conversation is first.
  persist([conv, ...loadConversations()]);
  return conv;
}

export function appendMessages(
  conversationId: string,
  messages: LocalMessage[],
): void {
  const all = loadConversations();
  const idx = all.findIndex((c) => c.id === conversationId);
  if (idx === -1) return;

  all[idx] = {
    ...all[idx],
    messages: [...all[idx].messages, ...messages],
    updatedAt: new Date().toISOString(),
  };

  // Re-sort so the most recently updated conversation surfaces first.
  all.sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );

  persist(all);
}

export function updateTitle(conversationId: string, title: string): void {
  const all = loadConversations();
  const idx = all.findIndex((c) => c.id === conversationId);
  if (idx === -1) return;
  all[idx] = { ...all[idx], title };
  persist(all);
}

export function deleteConversation(id: string): void {
  persist(loadConversations().filter((c) => c.id !== id));
}
