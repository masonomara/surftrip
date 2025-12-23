/**
 * Shared type definitions
 *
 * Types used across both API and web applications.
 */

export interface User {
  id: string;
  email: string;
  name?: string;
}

export interface Org {
  id: string;
  name: string;
  slug: string;
}

export type UserRole = "owner" | "admin" | "member";
