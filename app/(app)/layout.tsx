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
  // If Supabase is not configured, skip auth and run in guest-only mode.
  // Conversation history is stored in localStorage instead of the database.
  let user = null;
  let serverConversations: ConversationSummary[] = [];

  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    user = data.user;

    if (user) {
      const { data: convos } = await supabase
        .from("conversations")
        .select("id, title, updated_at")
        .order("updated_at", { ascending: false });

      serverConversations = convos ?? [];
    }
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
