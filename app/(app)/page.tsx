import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import GuestHome from "@/components/GuestHome";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: latest } = await supabase
      .from("conversations")
      .select("id")
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();

    if (latest) redirect(`/chat/${latest.id}`);

    const { data: created } = await supabase
      .from("conversations")
      .insert({ user_id: user.id, title: "New conversation" })
      .select("id")
      .single();

    if (created) redirect(`/chat/${created.id}`);
  }

  return <GuestHome />;
}
