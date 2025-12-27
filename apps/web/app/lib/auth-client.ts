import { createAuthClient } from "better-auth/react";

const isLocalhost =
  typeof window !== "undefined" && window.location.hostname === "localhost";

export const API_URL = isLocalhost
  ? "http://localhost:8787"
  : "https://api.docketadmin.com";

const client = createAuthClient({
  baseURL: API_URL,
  fetchOptions: {
    credentials: "include",
  },
});

export const authClient = client;
export const { useSession, signIn, signUp, signOut } = client;
