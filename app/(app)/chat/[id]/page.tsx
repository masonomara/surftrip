import { createClient } from "@/lib/supabase/server";
import ChatView from "./ChatView";
import type { AppMessage } from "@/lib/types";

type Props = { params: Promise<{ id: string }> };

export default async function ChatPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let initialMessages: AppMessage[] = [];

  if (user) {
    const { data } = await supabase
      .from("messages")
      .select("id, role, content, created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });

    initialMessages = (data ?? []).map((msg) => ({
      id: msg.id,
      role: msg.role as "user" | "assistant",
      parts: [{ type: "text" as const, text: msg.content }],
      createdAt: new Date(msg.created_at),
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
