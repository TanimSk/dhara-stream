import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Dev: the dashboard proxies the API (same origin, like nginx in production).
// The player/gate runs on Django :8000 directly (its own origin, like play.<domain>).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: { exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"] },
  server: {
    proxy: {
      "/api": { target: "http://127.0.0.1:8000", xfwd: true },
    },
  },
});
