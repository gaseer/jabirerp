import {
  db,
  type AttendanceRow,
  type DocumentRow,
  type EmployeeRow,
  type LineItemRow,
  type ProfileRow,
  type ShopRow,
  type SiteRow,
  type SiteTaskRow,
  type TransactionRow,
} from "@/lib/db";
import { currentOwnerId } from "@/store/auth";
import { DexieRepo } from "./DexieRepo";

/**
 * Concrete repo instances. Every entity in later slices adds one line here.
 * Owner id is read lazily at write time from the auth store.
 */
export const profileRepo = new DexieRepo<ProfileRow>(
  db.profiles,
  "profiles",
  currentOwnerId,
);

export const siteRepo = new DexieRepo<SiteRow>(db.sites, "sites", currentOwnerId);

export const documentRepo = new DexieRepo<DocumentRow>(
  db.documents,
  "documents",
  currentOwnerId,
);

export const lineItemRepo = new DexieRepo<LineItemRow>(
  db.line_items,
  "line_items",
  currentOwnerId,
);

export const transactionRepo = new DexieRepo<TransactionRow>(
  db.transactions,
  "transactions",
  currentOwnerId,
);

export const employeeRepo = new DexieRepo<EmployeeRow>(
  db.employees,
  "employees",
  currentOwnerId,
);

export const attendanceRepo = new DexieRepo<AttendanceRow>(
  db.attendance,
  "attendance",
  currentOwnerId,
);

export const shopRepo = new DexieRepo<ShopRow>(db.shops, "shops", currentOwnerId);

export const siteTaskRepo = new DexieRepo<SiteTaskRow>(
  db.site_tasks,
  "site_tasks",
  currentOwnerId,
);
