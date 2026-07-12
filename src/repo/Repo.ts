/**
 * Repo — the sync boundary. UI and domain code talk ONLY to this interface,
 * never to Supabase or Dexie directly.
 *
 * - Reads always come from the local store (Dexie = source of truth).
 * - Writes go local-first, then get queued to an outbox for background sync.
 * - A SupabaseSync implementation drains the outbox (push) and pulls remote
 *   changes when online. In Slice 0 that sync is a stub.
 */

/** Fields every synced entity carries. Designed once here, reused by every table. */
export interface BaseEntity {
  id: string; // client-generated UUID (stable offline)
  owner_id: string; // = auth user id; enforced by RLS server-side
  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp
  deleted_at: string | null; // soft-delete flag; never hard-destroy history
  _dirty: 0 | 1; // 1 = local change not yet pushed
}

/** A queued write awaiting push to Supabase. */
export interface OutboxItem {
  id: string; // uuid of this outbox entry
  table: string; // target table name
  op: "put" | "delete";
  row_id: string; // entity id affected
  payload: unknown; // full row snapshot at write time
  queued_at: string;
}

export type NewEntity<T extends BaseEntity> = Omit<
  T,
  "id" | "created_at" | "updated_at" | "deleted_at" | "_dirty" | "owner_id"
> &
  Partial<Pick<T, "id">>;

export interface Repo<T extends BaseEntity> {
  /** All non-deleted rows for the current owner. */
  getAll(): Promise<T[]>;
  getById(id: string): Promise<T | undefined>;
  /** Insert or update; sets timestamps, marks dirty, queues to outbox. */
  put(entity: NewEntity<T> & Partial<T>): Promise<T>;
  /** Soft-delete: sets deleted_at, marks dirty, queues to outbox. */
  softDelete(id: string): Promise<void>;
}

/** The sync engine contract. Slice 0 ships a stub; Slice 1 makes it real. */
export interface SyncEngine {
  /** Push queued outbox items to Supabase. */
  push(): Promise<{ pushed: number }>;
  /** Pull remote changes into the local store. */
  pull(): Promise<{ pulled: number }>;
  /** Convenience: push then pull. */
  sync(): Promise<{ pushed: number; pulled: number }>;
}
