import Dexie, { type Table } from "dexie";
import type { BaseEntity, OutboxItem } from "@/repo/Repo";

/** Local mirror of the profiles row. Proves the owner_id + sync pattern. */
export interface ProfileRow extends BaseEntity {
  display_name: string | null;
}

export type WorkType = "Electrical" | "Plumbing" | "Mixed";
export type SiteStatus = "Active" | "Completed";

/** A site = one customer/project. */
export interface SiteRow extends BaseEntity {
  name: string;
  phone: string | null;
  location: string | null;
  work_type: WorkType;
  status: SiteStatus;
}

export type DocKind = "quotation" | "bill";
export type DocStatus = "draft" | "converted" | "final";

/** A quotation or bill header for a site. Total is derived from line_items. */
export interface DocumentRow extends BaseEntity {
  site_id: string;
  kind: DocKind;
  doc_number: string | null;
  status: DocStatus;
}

/** A single priced line on a document. amount_paise = round(qty * rate_paise). */
export interface LineItemRow extends BaseEntity {
  document_id: string;
  description: string;
  qty: number;
  rate_paise: number;
  amount_paise: number;
  position: number;
}

/** Key/value store for sync cursors and other local-only metadata. */
export interface MetaRow {
  key: string;
  value: string;
}

/**
 * Dexie is the LOCAL SOURCE OF TRUTH. Every synced table is mirrored here.
 * The `outbox` holds writes queued for push to Supabase; `meta` holds sync
 * cursors (last-seen updated_at per table).
 */
export class PowerPlusDB extends Dexie {
  profiles!: Table<ProfileRow, string>;
  sites!: Table<SiteRow, string>;
  documents!: Table<DocumentRow, string>;
  line_items!: Table<LineItemRow, string>;
  outbox!: Table<OutboxItem, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super("powerplus");
    this.version(1).stores({
      profiles: "id, owner_id, deleted_at, _dirty, updated_at",
      outbox: "id, table, row_id, queued_at",
    });
    // v2: add sites + meta (Slice 1).
    this.version(2).stores({
      profiles: "id, owner_id, deleted_at, _dirty, updated_at",
      sites: "id, owner_id, deleted_at, _dirty, updated_at, status",
      outbox: "id, table, row_id, queued_at",
      meta: "key",
    });
    // v3: add documents + line_items (Slice 2).
    this.version(3).stores({
      profiles: "id, owner_id, deleted_at, _dirty, updated_at",
      sites: "id, owner_id, deleted_at, _dirty, updated_at, status",
      documents: "id, owner_id, site_id, kind, deleted_at, _dirty, updated_at",
      line_items: "id, owner_id, document_id, deleted_at, _dirty, updated_at",
      outbox: "id, table, row_id, queued_at",
      meta: "key",
    });
  }
}

export const db = new PowerPlusDB();

export async function getMeta(key: string): Promise<string | undefined> {
  return (await db.meta.get(key))?.value;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value });
}
