import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    target: "es2022",
    manifest: true,
    sourcemap: false,
    // Inline nothing: CSP forbids inline scripts, and data: URIs defeat caching.
    assetsInlineLimit: 0,
    rolldownOptions: {
      output: {
        codeSplitting: {
          // Fixed chunks for what every screen loads, so the first screen's request count stays
          // steady (≤ 12, handoff §14) instead of following automatic splitting, which put each
          // small shared module in a file of its own (D-UI-02).
          groups: [
            {
              name: "vendor",
              test: /node_modules[\\/](react|react-dom|scheduler|@tanstack)[\\/]/,
            },
            {
              // The app's own modules that 20 or more chunks share (the API client, buttons, cards…).
              name: "shared",
              test: /[\\/]src[\\/]/,
              minShareCount: 20,
            },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3000" },
  },
});
