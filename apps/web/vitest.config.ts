import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react() as any],

  test: {
    // Use jsdom for browser-like environment
    environment: "jsdom",

    // Look for tests in app/ and test/ directories
    include: ["app/**/*.test.ts?(x)", "test/**/*.test.ts?(x)"],

    // Run setup before each test file
    setupFiles: ["./test/setup.ts"],
  },

  resolve: {
    alias: {
      // Allow imports like "~/components/Button"
      "~": resolve(__dirname, "./app"),
    },
  },
});
