import { createClient } from "@/lib/supabase/server";
import ChatView from "@/components/ChatView";
import type { AppMessage } from "@/lib/types";

// ── Types ──────────────────────────────────────────────────────────────────

type Props = {
  params: Promise<{ id: string }>;
};

// ── Component ──────────────────────────────────────────────────────────────

export default async function ChatPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;

  // Guest users get no server-side messages — their history lives in
  // localStorage and is loaded client-side by ChatView after mount.
  let initialMessages: AppMessage[] = [];

  if (user) {
    const { data } = await supabase!
      .from("messages")
      .select("id, role, content, created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });

    // Map flat DB rows into the AI SDK's message shape. The SDK expects message
    // content as an array of typed parts; we only store plain text, so each
    // message has exactly one text part.
    initialMessages = (data ?? []).map((row) => ({
      id: row.id,
      role: row.role as "user" | "assistant", // DB stores role as string; cast is safe because we only ever insert these two values
      parts: [{ type: "text" as const, text: row.content }],
      createdAt: new Date(row.created_at),
    }));
  }

  return (
    <ChatView
      chatId={id}
      initialMessages={initialMessages}
      isAuthenticated={!!user}
    />
  );
}
