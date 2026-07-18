/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // autoUpdate: new deploys activate on next launch without a prompt UI —
      // "prompt" needs an update banner we never built, so updates were stuck.
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "pwa-icon.svg"],
      manifest: {
        name: "Power Plus",
        short_name: "Power Plus",
        description: "Offline-first contractor ERP",
        theme_color: "#2563eb",
        background_color: "#f4f6f9",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "pwa-icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        navigateFallback: "index.html",
      },
      devOptions: {
        enabled: true,
        type: "module",
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 4599,
  },
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
