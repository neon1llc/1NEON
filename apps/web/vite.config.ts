// apps/web/vite.config.ts - Vite build for the web app.


import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";


// Served from neon1.tech/1NEON/; locally the API runs on :8787 and is proxied
export default defineConfig({
  // Asset URLs and the router both live under /1NEON/ on neon1.tech
  base: "/1NEON/",
  plugins: [react()],
  // Same-origin in dev too: the API proxy keeps cookies and paths identical to production
  server: { port: 5173, proxy: { "/1NEON/api": "http://localhost:8787" } },
  // dist/1NEON mirrors the bucket's 1NEON/ prefix; source maps are built but never linked or uploaded
  build: { outDir: "dist/1NEON", emptyOutDir: true, sourcemap: "hidden" },
});
