import { db, getMeta, setMeta } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { currentOwnerId, isWorkerSession } from "@/store/auth";
import type { BaseEntity, SyncEngine } from "./Repo";
import { SYNC_TABLES, tableFor } from "./syncRegistry";

/** Tables a worker session has any RLS access to — pulling the rest just
 * wastes a round trip (RLS returns empty for them), so skip it outright. */
const WORKER_SYNC_TABLE_NAMES = new Set(["employees", "attendance", "transactions"]);

const EPOCH = "1970-01-01T00:00:00Z";

/** Supabase caps a select at 1000 rows by default — pull in explicit pages. */
const PULL_PAGE = 1000;

/** Fired on window after every sync() with `detail: { pushed, pulled }`. */
export const SYNC_DONE_EVENT = "powerplus:synced";

/** Local-only fields that must not be sent to Postgres. */
function stripLocal<T extends Record<string, unknown>>(row: T): Omit<T, "_dirty"> {
  const { _dirty, ...rest } = row;
  void _dirty;
  return rest;
}

function isOnline() {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

/**
 * Timestamps come in two shapes: local writes are "…Z" ISO strings, Postgres
 * returns "…+00:00" with microseconds. Comparing them lexically is WRONG —
 * always compare as epoch milliseconds.
 */
function ts(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Real sync engine.
 *
 * PUSH: drain the outbox oldest-first, upsert each payload to its Supabase
 * table (RLS enforces owner). On success delete the outbox row; once a row has
 * no pending outbox entries, clear its local `_dirty` flag. On error, skip the
 * REST OF THAT TABLE's items (order within a table is causal) but keep pushing
 * other tables — one bad row must never wedge the whole outbox.
 *
 * PULL: per table, page through rows with updated_at > local cursor (server
 * time is authoritative via trigger), merge with last-write-wins, and never
 * clobber a locally-dirty row (its unpushed edit wins until pushed). Advance
 * the cursor. A failing table doesn't stop the others.
 *
 * sync() = push then pull, so local edits reach the server before we pull them
 * back — avoids a stale pull overwriting a fresh local change.
 */
export class SupabaseSync implements SyncEngine {
  async push(): Promise<{ pushed: number }> {
    if (!isOnline()) return { pushed: 0 };
    const items = await db.outbox.orderBy("queued_at").toArray();
    let pushed = 0;
    const failedTables = new Set<string>();

    // Coalesce: several queued snapshots of the same row+op — only the newest
    // matters (each payload is a full-row snapshot). Drop older ones unpushed.
    const newestPerRow = new Map<string, string>();
    for (const item of items) {
      newestPerRow.set(`${item.table}:${item.row_id}:${item.op}`, item.id);
    }

    const owner = currentOwnerId();

    for (const item of items) {
      if (newestPerRow.get(`${item.table}:${item.row_id}:${item.op}`) !== item.id) {
        await db.outbox.delete(item.id); // superseded by a newer snapshot
        continue;
      }
      // A row queued under a DIFFERENT account can never pass RLS with this
      // session — it would 403 forever and wedge its table's queue. Drop it
      // (the row itself stays in Dexie; only the doomed push is discarded).
      const payloadOwner = (item.payload as Record<string, unknown>)?.owner_id;
      if (owner && payloadOwner && payloadOwner !== owner) {
        if (import.meta.env.DEV)
          console.warn(`[sync] dropping ${item.table} push from another account`);
        await db.outbox.delete(item.id);
        continue;
      }
      // Preserve causal order within a failed table; keep other tables flowing.
      if (failedTables.has(item.table)) continue;

      const row = stripLocal(item.payload as Record<string, unknown>);
      const { error } = await supabase.from(item.table).upsert(row);
      if (error) {
        // Not DEV-gated: a persistently failing table (e.g. schema drift) is
        // otherwise invisible — rows just never appear on other devices.
        console.warn(`[sync] push ${item.table}:`, error.message);
        failedTables.add(item.table);
        continue; // leave this table's items queued for retry
      }
      await db.outbox.delete(item.id);
      pushed++;

      // Clear _dirty once nothing else is queued for this row.
      const remaining = await db.outbox.where("row_id").equals(item.row_id).count();
      if (remaining === 0) {
        const table = tableFor(item.table);
        const local = table ? await table.get(item.row_id) : undefined;
        if (table && local && local._dirty === 1) {
          await table.put({ ...local, _dirty: 0 });
        }
      }
    }
    return { pushed };
  }

  async pull(): Promise<{ pulled: number }> {
    if (!isOnline()) return { pulled: 0 };
    let pulled = 0;
    const worker = isWorkerSession();

    for (const st of SYNC_TABLES) {
      if (worker && !WORKER_SYNC_TABLE_NAMES.has(st.name)) continue;
      const cursorKey = `cursor:${st.name}`;
      let cursor = (await getMeta(cursorKey)) ?? EPOCH;

      // Page until a short page so no rows beyond the server cap are missed.
      for (;;) {
        const { data, error } = await supabase
          .from(st.name)
          .select("*")
          .gt("updated_at", cursor)
          .order("updated_at", { ascending: true })
          .limit(PULL_PAGE);

        if (error) {
          console.warn(`[sync] pull ${st.name}:`, error.message);
          break; // this table retries next sync; keep pulling the others
        }

        const rows = (data ?? []) as unknown as BaseEntity[];
        let maxCursor = cursor;
        for (const remote of rows) {
          const local = await st.table.get(remote.id);
          if (ts(remote.updated_at) > ts(maxCursor)) maxCursor = remote.updated_at;
          if (local?._dirty === 1) continue; // protect unpushed local edit
          if (local && ts(local.updated_at) > ts(remote.updated_at)) continue; // local newer
          await st.table.put({ ...remote, _dirty: 0 });
          pulled++;
        }

        if (maxCursor !== cursor) await setMeta(cursorKey, maxCursor);
        // Short page = caught up. Unmoved cursor guards against an infinite
        // loop if a full page shares one timestamp (pathological).
        if (rows.length < PULL_PAGE || maxCursor === cursor) break;
        cursor = maxCursor;
      }
    }
    return { pulled };
  }

  async sync(): Promise<{ pushed: number; pulled: number }> {
    const { pushed } = await this.push();
    const { pulled } = await this.pull();
    const result = { pushed, pulled };
    // Let the UI (useSyncEngine) know fresh rows may have landed — fire-and-
    // forget sync.sync() calls after writes get query invalidation this way.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(SYNC_DONE_EVENT, { detail: result }));
    }
    return result;
  }
}

export const sync = new SupabaseSync();
