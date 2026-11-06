import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Served from neon1.tech/1NEON/; locally the API runs on :8787 and is proxied.
export default defineConfig({
  base: "/1NEON/",
  plugins: [react()],
  server: { port: 5173, proxy: { "/1NEON/api": "http://localhost:8787" } },
  build: { outDir: "dist/1NEON", emptyOutDir: true, sourcemap: "hidden" },
});
