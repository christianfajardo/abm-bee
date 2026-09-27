import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: './' so the built assets are relative paths — FastAPI serves the
// bundle at the site root and the API stays same-origin (/api/...).
//
// __BUILD_STAMP__ is injected at build time (UTC timestamp). It changes on
// every rebuild, so a user can see at a glance whether their tab is running
// a stale cached bundle (the app footer shows the stamp).
const BUILD_STAMP = new Date().toISOString().replace("T", " ").slice(0, 16) + "Z";

export default defineConfig({
  base: "./",
  define: { __BUILD_STAMP__: JSON.stringify(BUILD_STAMP) },
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:8550", changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 4200, // plotly + pixi are large; expected
  },
});