import { createAuthClient } from "better-auth/react";

const getBaseURL = () => {
  if (typeof window === "undefined") {
    // SSR: return production URL (auth calls rehydrate on client)
    return "https://api.docketadmin.com";
  }

  // Client-side: detect environment from hostname
  if (window.location.hostname === "localhost") {
    return "http://localhost:8787";
  }

  return "https://api.docketadmin.com";
};

export const authClient = createAuthClient({
  baseURL: getBaseURL(),
});

export const { useSession, signIn, signUp, signOut } = authClient;
