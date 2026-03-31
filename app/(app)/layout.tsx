import { createClient } from "@/lib/supabase/server";
import { ProcessLogProvider } from "@/lib/process-log-context";
import ConversationSidebar from "@/components/ConversationSidebar";
import ProcessLog from "@/components/ProcessLog";
import type { Tables } from "@/lib/types";
import styles from "./layout.module.css";

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
    <div className={styles.shell}>
      <ConversationSidebar
        serverConversations={serverConversations}
        isAuthenticated={!!user}
      />
      <ProcessLogProvider>
        <main className={styles.main}>{children}</main>
        <ProcessLog />
      </ProcessLogProvider>
    </div>
  );
}
