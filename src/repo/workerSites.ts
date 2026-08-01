import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";

/**
 * Refreshes the offline cache of site NAMES a worker may mark attendance
 * against, via the worker_site_names RPC (never the sites table — RLS has no
 * policy granting a worker read access to it). No-ops offline; callers should
 * always read from listWorkerSiteCache() afterwards, which returns whatever
 * was last cached even when this no-ops.
 */
export async function refreshWorkerSiteCache(): Promise<void> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  const { data, error } = await supabase.rpc("worker_site_names");
  if (error || !data) return;
  await db.worker_site_cache.clear();
  await db.worker_site_cache.bulkPut(data as { id: string; name: string }[]);
}

export function listWorkerSiteCache(): Promise<{ id: string; name: string }[]> {
  return db.worker_site_cache.toArray();
}
