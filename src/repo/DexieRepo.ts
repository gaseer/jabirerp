import type { Table } from "dexie";
import { db } from "@/lib/db";
import type { BaseEntity, NewEntity, OutboxItem, Repo } from "./Repo";

const nowIso = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

/**
 * Generic Dexie-backed Repo. Local-first: every write lands in IndexedDB
 * immediately and is queued to the outbox for later push to Supabase.
 *
 * @param table   the Dexie table for this entity
 * @param tableName  server table name (used for outbox routing + RLS)
 * @param getOwnerId  returns the current auth user id (owner) at write time
 */
export class DexieRepo<T extends BaseEntity> implements Repo<T> {
  constructor(
    private table: Table<T, string>,
    private tableName: string,
    private getOwnerId: () => string,
  ) {}

  async getAll(): Promise<T[]> {
    const rows = await this.table.toArray();
    return rows
      .filter((r) => r.deleted_at === null)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async getById(id: string): Promise<T | undefined> {
    const row = await this.table.get(id);
    if (!row || row.deleted_at !== null) return undefined;
    return row;
  }

  async put(entity: NewEntity<T> & Partial<T>): Promise<T> {
    const existing = entity.id ? await this.table.get(entity.id) : undefined;
    const now = nowIso();

    const row = {
      ...(existing ?? {}),
      ...entity,
      id: entity.id ?? uuid(),
      owner_id: this.getOwnerId(),
      created_at: existing?.created_at ?? now,
      updated_at: now,
      deleted_at: existing?.deleted_at ?? null,
      _dirty: 1,
    } as T;

    await this.table.put(row);
    await this.enqueue("put", row.id, row);
    return row;
  }

  async softDelete(id: string): Promise<void> {
    const existing = await this.table.get(id);
    if (!existing) return;
    const row = {
      ...existing,
      deleted_at: nowIso(),
      updated_at: nowIso(),
      _dirty: 1,
    } as T;
    await this.table.put(row);
    await this.enqueue("delete", id, row);
  }

  private async enqueue(
    op: OutboxItem["op"],
    rowId: string,
    payload: unknown,
  ): Promise<void> {
    const item: OutboxItem = {
      id: uuid(),
      table: this.tableName,
      op,
      row_id: rowId,
      payload,
      queued_at: nowIso(),
    };
    await db.outbox.put(item);
  }
}
