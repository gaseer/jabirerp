import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  // Non-fatal: app still runs offline; auth calls will fail until .env is set.
  console.warn(
    "[supabase] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.",
  );
}

export const supabase = createClient(url ?? "http://localhost", anonKey ?? "anon", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: "powerplus-auth",
  },
});
