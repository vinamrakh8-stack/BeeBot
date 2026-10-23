import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Same-origin API calls keep the HttpOnly session cookie and the SSE
      // stream working without CORS special-casing in the browser.
      "/api": {
        target: "http://127.0.0.1:5000",
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
