import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the web app runs on :5173 and forwards API calls to the api on :3000.
const api = process.env.VITE_API_TARGET ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: { include: ["@dnd-kit/core", "@dnd-kit/sortable", "@dnd-kit/utilities"] },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: {
    port: 5173,
    proxy: { "/api": api, "/health": api },
    // The browser tests write traces, screenshots and results under e2e/ while a page is open; a change there must not reload the page.
    watch: { ignored: ["**/e2e/**"] },
  },
});
