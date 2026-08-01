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

/**
 * `quotation`/`bill` are the two ends of the convert flow — at most ONE of each
 * per site. `invoice` is the DIRECT bill: the contractor types works + items
 * straight into it, no quotation first, and a site may have many of them.
 */
export type DocKind = "quotation" | "bill" | "invoice";
export type DocStatus = "draft" | "converted" | "final";

/**
 * A quotation / bill / direct invoice header for a site. Total is always
 * derived from line_items (minus `discount_paise`), never stored.
 * `doc_date`/`title`/`notes`/`discount_paise` are only used by invoices;
 * quotation and bill rows leave them null/0.
 */
export interface DocumentRow extends BaseEntity {
  site_id: string;
  kind: DocKind;
  doc_number: string | null;
  status: DocStatus;
  doc_date: string | null; // local calendar date, YYYY-MM-DD
  title: string | null; // e.g. "Ground floor wiring"
  notes: string | null; // printed under the total (terms, thanks…)
  discount_paise: number; // 0 = none; clamped to the subtotal when applied
}

/**
 * A single priced line on a document. amount_paise = round(qty * rate_paise).
 * `section` groups lines on an invoice ("Works", "Materials"…) and drives the
 * printed subtotals; `unit` is the billing unit ("nos", "mtr", "pt"…). Both are
 * null on quotation/bill lines.
 */
export interface LineItemRow extends BaseEntity {
  document_id: string;
  description: string;
  qty: number;
  rate_paise: number;
  amount_paise: number;
  position: number;
  section: string | null;
  unit: string | null;
}

export type TxnType =
  | "customer_advance"
  | "site_expense"
  | "worker_payment"
  | "shop_in"
  | "shop_out";
export type TxnMode = "cash" | "bank";

/**
 * One row per money movement, every type. Direction (in/out) is DERIVED from
 * txn_type, never stored. Per-type shape (which FK/category is set) is
 * enforced by assertValidTxn client-side and CHECK constraints server-side.
 * Financial rows are append-only: corrections = soft-delete + re-add.
 */
export interface TransactionRow extends BaseEntity {
  txn_type: TxnType;
  amount_paise: number;
  mode: TxnMode;
  txn_date: string; // local calendar date, YYYY-MM-DD
  site_id: string | null;
  employee_id: string | null;
  shop_id: string | null;
  category: string | null;
  note: string | null;
}

export type EmployeeRole = "Electrician" | "Plumber" | "Helper";

export interface EmployeeRow extends BaseEntity {
  name: string;
  phone: string | null;
  role: EmployeeRole;
  hourly_wage_paise: number;
  // Set once by the claim_employee RPC when the worker activates self-service
  // login — never written by the client. Optional (not just nullable) so
  // every existing employeeRepo.put() call site (admin create/edit) can omit
  // it entirely; DexieRepo.put()'s merge-over-existing then leaves an
  // already-claimed row's id untouched instead of overwriting it with null.
  // undefined/null both mean "not activated yet".
  auth_user_id?: string | null;
}

/**
 * pending = worker self-marked, not yet reviewed; approved = counts in wages/
 * settlement/P&L; rejected = excluded permanently. Admin-marked attendance is
 * always "approved" immediately (no self-approval loop for trusted entries).
 */
export type AttendanceStatus = "pending" | "approved" | "rejected";

/**
 * One worked shift: from/to clock times on a date. hours is derived from the
 * times and stored; wage_paise is the fully computed amount, rounded ONCE at
 * write time from the employee's then-current hourly wage — later wage edits
 * never rewrite history.
 */
export interface AttendanceRow extends BaseEntity {
  employee_id: string;
  site_id: string;
  work_date: string; // local calendar date, YYYY-MM-DD
  start_time: string; // "HH:MM" 24h, zero-padded
  end_time: string; // "HH:MM", must be after start_time (no overnight shifts)
  hours: number; // (end − start) in hours, may be fractional (e.g. 4.5)
  wage_paise: number;
  status: AttendanceStatus;
}

/** A shop the contractor routes customer money through (pass-through dues). */
export interface ShopRow extends BaseEntity {
  name: string;
  phone: string | null;
  site_id: string | null;
}

/** Per-site pending-works checklist item. Not financial: edited in place. */
export interface SiteTaskRow extends BaseEntity {
  site_id: string;
  text: string;
  done: boolean;
}

/** Key/value store for sync cursors and other local-only metadata. */
export interface MetaRow {
  key: string;
  value: string;
}

/**
 * Local-only, unsynced cache of site NAMES a worker may mark attendance
 * against (populated from the worker_site_names RPC whenever online, read
 * from directly so marking attendance works offline too). Never appears in
 * SYNC_TABLES — it is not a BaseEntity, has no owner_id, and is never pushed.
 */
export interface WorkerSiteCacheRow {
  id: string;
  name: string;
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
  transactions!: Table<TransactionRow, string>;
  employees!: Table<EmployeeRow, string>;
  attendance!: Table<AttendanceRow, string>;
  shops!: Table<ShopRow, string>;
  site_tasks!: Table<SiteTaskRow, string>;
  outbox!: Table<OutboxItem, string>;
  meta!: Table<MetaRow, string>;
  worker_site_cache!: Table<WorkerSiteCacheRow, string>;

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
    // v4: add transactions (Slice 4). NOTE: deleted_at is deliberately NOT
    // indexed on new tables — Dexie cannot index null, so rows with
    // deleted_at: null would vanish from that index. Always query by a real
    // index (or toArray) and filter deleted_at === null in JS.
    this.version(4).stores({
      transactions:
        "id, owner_id, site_id, employee_id, shop_id, txn_type, txn_date, _dirty, updated_at",
    });
    // v5: add employees + attendance (Slice 5).
    this.version(5).stores({
      employees: "id, owner_id, _dirty, updated_at",
      attendance:
        "id, owner_id, employee_id, site_id, work_date, _dirty, updated_at",
    });
    // v6: add shops (Slice 9).
    this.version(6).stores({
      shops: "id, owner_id, site_id, _dirty, updated_at",
    });
    // v7: add site_tasks (Slice 11).
    this.version(7).stores({
      site_tasks: "id, owner_id, site_id, _dirty, updated_at",
    });
    // v8: hourly wages. employees.daily_wage_paise -> hourly_wage_paise
    // (converted at 8h/day); attendance unit/half-day model -> start/end
    // times. Old rows get synthetic times so their snapshotted wage_paise
    // (history) is preserved untouched. No index changes.
    this.version(8).upgrade(async (tx) => {
      await tx
        .table("employees")
        .toCollection()
        .modify((e: Record<string, unknown>) => {
          if (typeof e.daily_wage_paise === "number") {
            e.hourly_wage_paise = Math.round((e.daily_wage_paise as number) / 8);
            delete e.daily_wage_paise;
          }
        });
      await tx
        .table("attendance")
        .toCollection()
        .modify((a: Record<string, unknown>) => {
          if (a.start_time) return; // already new shape
          const oldHours =
            a.unit === "half" ? 4 : a.unit === "custom" ? Number(a.hours) || 8 : 8;
          const endMin = Math.round(9 * 60 + oldHours * 60);
          const hh = String(Math.floor(endMin / 60)).padStart(2, "0");
          const mm = String(endMin % 60).padStart(2, "0");
          a.start_time = "09:00";
          a.end_time = `${hh}:${mm}`;
          a.hours = oldHours;
          delete a.unit;
        });
    });
    // v9: direct invoices (Slice 12). documents gain doc_date/title/notes/
    // discount_paise; line_items gain section/unit. Backfilled so old rows
    // never carry `undefined` into money math or a Supabase upsert.
    this.version(9).upgrade(async (tx) => {
      await tx
        .table("documents")
        .toCollection()
        .modify((d: Record<string, unknown>) => {
          d.doc_date ??= null;
          d.title ??= null;
          d.notes ??= null;
          d.discount_paise ??= 0;
        });
      await tx
        .table("line_items")
        .toCollection()
        .modify((i: Record<string, unknown>) => {
          i.section ??= null;
          i.unit ??= null;
        });
    });
    // v10: worker self-service login. employees gain auth_user_id (backfilled
    // null = not activated); attendance gains status (backfilled "approved"
    // so existing history keeps counting exactly as before). worker_site_cache
    // is new and local-only — a plain `.stores()` addition needs no upgrade.
    this.version(10)
      .stores({
        worker_site_cache: "id",
      })
      .upgrade(async (tx) => {
        await tx
          .table("employees")
          .toCollection()
          .modify((e: Record<string, unknown>) => {
            e.auth_user_id ??= null;
          });
        await tx
          .table("attendance")
          .toCollection()
          .modify((a: Record<string, unknown>) => {
            a.status ??= "approved";
          });
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

const LAST_AUTH_UID_KEY = "last-auth-uid";

/**
 * Defensive isolation: DexieRepo.getAll() doesn't scope by identity (there's
 * only ever meant to be one signed-in identity per browser). If the signed-in
 * user changes — an owner and a worker sharing a device, or a plain account
 * switch — wipe every synced table + the outbox + sync cursors so the new
 * identity's next pull starts from a clean slate instead of seeing (or
 * silently pushing under) the previous identity's rows.
 */
export async function resetLocalDataIfIdentityChanged(userId: string): Promise<void> {
  const last = await getMeta(LAST_AUTH_UID_KEY);
  if (last === userId) return;
  if (last !== undefined) {
    await db.transaction(
      "rw",
      [
        db.profiles,
        db.sites,
        db.documents,
        db.line_items,
        db.transactions,
        db.employees,
        db.attendance,
        db.shops,
        db.site_tasks,
        db.outbox,
        db.meta,
        db.worker_site_cache,
      ],
      async () => {
        await Promise.all([
          db.profiles.clear(),
          db.sites.clear(),
          db.documents.clear(),
          db.line_items.clear(),
          db.transactions.clear(),
          db.employees.clear(),
          db.attendance.clear(),
          db.shops.clear(),
          db.site_tasks.clear(),
          db.outbox.clear(),
          db.meta.clear(),
          db.worker_site_cache.clear(),
        ]);
      },
    );
  }
  await setMeta(LAST_AUTH_UID_KEY, userId);
}
