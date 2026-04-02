import { createClient } from "@/lib/supabase/server";
import { ToolCallsProvider } from "@/lib/tool-calls-context";
import AppShell from "@/components/AppShell";
import type { ConversationSummary } from "@/lib/types";

// ── Types ──────────────────────────────────────────────────────────────────

type Props = {
  children: React.ReactNode;
};

// ── Component ──────────────────────────────────────────────────────────────

export default async function AppLayout({ children }: Props) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Guest users have no server-side conversations — their history lives in
  // localStorage and is loaded client-side by ConversationSidebar.
  let serverConversations: ConversationSummary[] = [];

  if (user) {
    const { data } = await supabase
      .from("conversations")
      .select("id, title, updated_at")
      .order("updated_at", { ascending: false });

    serverConversations = data ?? [];
  }

  return (
    <ToolCallsProvider>
      <AppShell
        serverConversations={serverConversations}
        isAuthenticated={!!user}
      >
        {children}
      </AppShell>
    </ToolCallsProvider>
  );
}
