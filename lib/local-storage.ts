import type { LocalConversation, LocalMessage } from "@/lib/types";

// ── Constants ──────────────────────────────────────────────────────────────

// All guest conversations live under this key as a JSON-serialized
// LocalConversation[], sorted by updatedAt descending.
const STORAGE_KEY = "surftrip_conversations";

// ── Read ───────────────────────────────────────────────────────────────────

export function loadConversations(): LocalConversation[] {
  // localStorage is not available during SSR.
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    // localStorage contains invalid JSON (corrupted or manually edited).
    // Return empty rather than crashing the app.
    return [];
  }
}

export function loadConversation(id: string): LocalConversation | null {
  return (
    loadConversations().find((conversation) => conversation.id === id) ?? null
  );
}

// ── Write ──────────────────────────────────────────────────────────────────

function persist(conversations: LocalConversation[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
}

export function createConversation(
  id: string,
  title: string,
): LocalConversation {
  const newConversation: LocalConversation = {
    id,
    title,
    updatedAt: new Date().toISOString(),
    messages: [],
  };

  // Prepend so the newest conversation is first without needing a sort.
  persist([newConversation, ...loadConversations()]);
  return newConversation;
}

export function appendMessages(
  conversationId: string,
  messages: LocalMessage[],
): void {
  const all = loadConversations();
  const index = all.findIndex(
    (conversation) => conversation.id === conversationId,
  );
  if (index === -1) return;

  all[index] = {
    ...all[index],
    messages: [...all[index].messages, ...messages],
    updatedAt: new Date().toISOString(),
  };

  // Re-sort so the most recently updated conversation surfaces first.
  all.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );

  persist(all);
}

export function updateTitle(conversationId: string, title: string): void {
  const all = loadConversations();
  const index = all.findIndex(
    (conversation) => conversation.id === conversationId,
  );
  if (index === -1) return;
  all[index] = { ...all[index], title };
  persist(all);
}

export function clearConversationMessages(id: string): void {
  const all = loadConversations();
  const index = all.findIndex((conversation) => conversation.id === id);
  if (index === -1) return;
  all[index] = {
    ...all[index],
    messages: [],
    updatedAt: new Date().toISOString(),
  };
  persist(all);
}

export function deleteConversation(id: string): void {
  persist(loadConversations().filter((conversation) => conversation.id !== id));
}
