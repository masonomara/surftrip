import path from "node:path";
import { reactRouter } from "@react-router/dev/vite";
import { cloudflareDevProxy } from "@react-router/dev/vite/cloudflare";
import { defineConfig } from "vite";

export default defineConfig(({ isSsrBuild }) => ({
  resolve: { alias: { "~": path.resolve(__dirname, "./app") } },
  build: {
    rollupOptions: isSsrBuild ? { input: "./workers/app.ts" } : undefined,
  },
  server: {
    port: 5173,
    watch: {
      // Ignore editor temp files to prevent HMR errors
      ignored: ["**/*.tmp*", "**/*~", "**/.#*"],
    },
  },
  plugins: [cloudflareDevProxy(), reactRouter()],
}));
