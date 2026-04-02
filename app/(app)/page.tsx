import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import GuestHome from "@/components/GuestHome";

// ── Component ──────────────────────────────────────────────────────────────
//
// This is the root page ("/"). Its only job is to redirect the user to a chat.
// Authenticated users are redirected server-side (no client JS needed).
// Guest users are handed off to <GuestHome>, which redirects client-side
// after reading localStorage (which the server can't access).

export default async function HomePage() {
  const supabase = await createClient();

  if (!supabase) {
    return <GuestHome />;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <GuestHome />;
  }

  // Send the user to their most recent conversation.
  const { data: mostRecentConversation } = await supabase
    .from("conversations")
    .select("id")
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();

  if (mostRecentConversation) {
    redirect(`/chat/${mostRecentConversation.id}`);
  }

  // No conversations exist yet — create one and send them there.
  const { data: newConversation } = await supabase
    .from("conversations")
    .insert({ user_id: user.id, title: "New conversation" })
    .select("id")
    .single();

  if (newConversation) {
    redirect(`/chat/${newConversation.id}`);
  }
}
