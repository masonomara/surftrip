import { createAuthClient } from "better-auth/react";

function getApiBaseUrl(): string {
  const isServer = typeof window === "undefined";
  if (isServer) {
    return "https://api.docketadmin.com";
  }

  const isLocalhost = window.location.hostname === "localhost";
  if (isLocalhost) {
    return "http://localhost:8787";
  }

  return "https://api.docketadmin.com";
}

export const authClient = createAuthClient({
  baseURL: getApiBaseUrl(),
});

export const { useSession, signIn, signUp, signOut } = authClient;
