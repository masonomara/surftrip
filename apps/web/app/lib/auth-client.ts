import { createAuthClient } from "better-auth/react";

export const API_URL =
  import.meta.env.VITE_API_URL || "https://api.docketadmin.com";

const client = createAuthClient({
  baseURL: API_URL,
  fetchOptions: {
    credentials: "include",
  },
});

export const authClient = client;
export const { useSession, signIn, signUp, signOut } = client;
