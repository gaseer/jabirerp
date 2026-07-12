import { db, getMeta, setMeta } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import type { BaseEntity, SyncEngine } from "./Repo";
import { SYNC_TABLES, tableFor } from "./syncRegistry";

const EPOCH = "1970-01-01T00:00:00Z";

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
 * Real sync engine (Slice 1).
 *
 * PUSH: drain the outbox oldest-first, upsert each payload to its Supabase
 * table (RLS enforces owner). On success delete the outbox row; once a row has
 * no pending outbox entries, clear its local `_dirty` flag. Stop on the first
 * error (offline / transient) leaving the rest queued for the next attempt.
 *
 * PULL: per table, fetch rows with updated_at > local cursor (server time is
 * authoritative via trigger), merge with last-write-wins, and never clobber a
 * locally-dirty row (its unpushed edit wins until pushed). Advance the cursor.
 *
 * sync() = push then pull, so local edits reach the server before we pull them
 * back — avoids a stale pull overwriting a fresh local change.
 */
export class SupabaseSync implements SyncEngine {
  async push(): Promise<{ pushed: number }> {
    if (!isOnline()) return { pushed: 0 };
    const items = await db.outbox.orderBy("queued_at").toArray();
    let pushed = 0;

    for (const item of items) {
      const row = stripLocal(item.payload as Record<string, unknown>);
      const { error } = await supabase.from(item.table).upsert(row);
      if (error) {
        if (import.meta.env.DEV) console.warn("[sync] push halted:", error.message);
        break; // leave this and remaining items queued for retry
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

    for (const st of SYNC_TABLES) {
      const cursorKey = `cursor:${st.name}`;
      const cursor = (await getMeta(cursorKey)) ?? EPOCH;

      const { data, error } = await supabase
        .from(st.name)
        .select("*")
        .gt("updated_at", cursor)
        .order("updated_at", { ascending: true });

      if (error) {
        if (import.meta.env.DEV) console.warn(`[sync] pull ${st.name}:`, error.message);
        break;
      }

      let maxCursor = cursor;
      for (const raw of data ?? []) {
        const remote = raw as unknown as BaseEntity;
        const local = await st.table.get(remote.id);
        if (local?._dirty === 1) continue; // protect unpushed local edit
        if (local && local.updated_at > remote.updated_at) continue; // local newer
        await st.table.put({ ...remote, _dirty: 0 });
        pulled++;
        if (remote.updated_at > maxCursor) maxCursor = remote.updated_at;
      }
      if (maxCursor !== cursor) await setMeta(cursorKey, maxCursor);
    }
    return { pulled };
  }

  async sync(): Promise<{ pushed: number; pulled: number }> {
    const { pushed } = await this.push();
    const { pulled } = await this.pull();
    return { pushed, pulled };
  }
}

export const sync = new SupabaseSync();
