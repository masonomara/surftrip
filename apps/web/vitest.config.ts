import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react() as any],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["app/**/*.test.ts", "app/**/*.test.tsx", "test/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "~": resolve(__dirname, "./app"),
    },
  },
});
