/// <reference types="vitest" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

/**
 * A production build with no Supabase vars is silently useless: Vite inlines
 * the fallback, the app ships, and the first sign-in dies with
 * ERR_CONNECTION_REFUSED against http://localhost. That is exactly how a
 * misconfigured Netlify deploy failed. Fail the BUILD instead — a red deploy
 * is far cheaper to notice than a white-screen login.
 *
 * CI builds that only prove the bundle compiles set SKIP_ENV_CHECK=1.
 */
function assertSupabaseEnv(mode: string): void {
  if (process.env.SKIP_ENV_CHECK) return;
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const missing = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"].filter(
    (k) => !env[k]?.trim(),
  );
  if (missing.length === 0) return;
  throw new Error(
    `Missing ${missing.join(" and ")} at build time.\n` +
      "  Local:   copy .env.example to .env and fill it in.\n" +
      "  Netlify: Site configuration -> Environment variables. Each var needs\n" +
      "           the 'Builds' scope and the 'Production' deploy context, then\n" +
      "           redeploy with 'Clear cache and deploy site'.\n" +
      "  CI that only checks compilation: set SKIP_ENV_CHECK=1.",
  );
}

export default defineConfig(({ command, mode }) => {
  if (command === "build") assertSupabaseEnv(mode);

  return {
    plugins: [
      react(),
      VitePWA({
        // autoUpdate: new deploys activate on next launch without a prompt UI —
        // "prompt" needs an update banner we never built, so updates were stuck.
        registerType: "autoUpdate",
        includeAssets: ["favicon.svg", "pwa-icon.svg", "pwa-icon.png"],
        manifest: {
          name: "POWER PLUS ELECTRICAL AND PLUMBING WORKS",
          // Home-screen label — must stay short, the full name is truncated there.
          short_name: "Power Plus",
          description: "Power Plus Electrical and Plumbing Works — offline-first contractor ERP",
          theme_color: "#2563eb",
          background_color: "#f4f6f9",
          display: "standalone",
          start_url: "/",
          icons: [
            // The real logo mark; the old placeholder SVG stays as a fallback.
            { src: "pwa-icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
            { src: "pwa-icon.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
            { src: "pwa-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
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
  };
});
