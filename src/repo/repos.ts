import {
  db,
  type DocumentRow,
  type LineItemRow,
  type ProfileRow,
  type SiteRow,
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
