import { createClient } from "@/lib/supabase/server";
import { ProcessLogProvider } from "@/lib/process-log-context";
import AppShell from "@/components/AppShell";
import type { Tables } from "@/lib/types";

type ConversationSummary = Pick<
  Tables<"conversations">,
  "id" | "title" | "updated_at"
>;

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let serverConversations: ConversationSummary[] = [];

  if (user) {
    const { data } = await supabase
      .from("conversations")
      .select("id, title, updated_at")
      .order("updated_at", { ascending: false });
    serverConversations = data ?? [];
  }

  return (
    <ProcessLogProvider>
      <AppShell
        serverConversations={serverConversations}
        isAuthenticated={!!user}
      >
        {children}
      </AppShell>
    </ProcessLogProvider>
  );
}
