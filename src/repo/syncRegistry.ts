import type { Table } from "dexie";
import { db } from "@/lib/db";
import type { BaseEntity } from "./Repo";

/**
 * Tables the sync engine mirrors between Dexie and Supabase.
 * Every synced entity adds one entry here. Order matters only if there are
 * FK dependencies at push time (none yet — sites are independent).
 */
export interface SyncTable {
  name: string;
  table: Table<BaseEntity, string>;
}

export const SYNC_TABLES: SyncTable[] = [
  { name: "profiles", table: db.profiles as unknown as Table<BaseEntity, string> },
  { name: "sites", table: db.sites as unknown as Table<BaseEntity, string> },
  // documents before line_items so the FK parent syncs first on pull.
  { name: "documents", table: db.documents as unknown as Table<BaseEntity, string> },
  { name: "line_items", table: db.line_items as unknown as Table<BaseEntity, string> },
];

export function tableFor(name: string): Table<BaseEntity, string> | undefined {
  return SYNC_TABLES.find((t) => t.name === name)?.table;
}
