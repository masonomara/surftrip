"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  createConversation,
  deleteConversation,
} from "@/lib/local-storage";

type Params = {
  isAuthenticated: boolean;
  activeChatId: string | null;
  onClose?: () => void;
};

type Actions = {
  handleNewChat: () => Promise<void>;
  handleDeleteConversation: (id: string) => Promise<void>;
  handleSignOut: () => Promise<void>;
};

export function useConversationActions({
  isAuthenticated,
  activeChatId,
  onClose,
}: Params): Actions {
  const router = useRouter();

  async function createAuthenticatedConversation() {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    const { data } = await supabase
      .from("conversations")
      .insert({ title: "New conversation", user_id: user.id })
      .select("id")
      .single();

    if (data) {
      router.push(`/chat/${data.id}`);
      router.refresh();
    }
  }

  function createGuestConversation() {
    const id = crypto.randomUUID();
    createConversation(id, "New conversation");
    window.dispatchEvent(new StorageEvent("storage"));
    router.push(`/chat/${id}`);
  }

  async function handleNewChat() {
    onClose?.();

    if (isAuthenticated) {
      await createAuthenticatedConversation();
    } else {
      createGuestConversation();
    }
  }

  async function handleDeleteConversation(id: string) {
    if (isAuthenticated) {
      const supabase = createClient();
      await supabase.from("conversations").delete().eq("id", id);
      router.refresh();
    } else {
      deleteConversation(id);
      window.dispatchEvent(new StorageEvent("storage"));
    }

    // Navigate away if the deleted conversation is the one currently open.
    if (id === activeChatId) {
      router.push("/");
    }
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return { handleNewChat, handleDeleteConversation, handleSignOut };
}
