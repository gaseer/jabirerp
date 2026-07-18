import { db } from "@/lib/db";
import { getDocByKind, listItems } from "./documents";
import { documentTotalPaise } from "./quotation";
import { listAttendance } from "./attendance";
import { listTxns, sumPaise } from "./transactions";
import { wagesEarnedPaise } from "./wages";
import { empBalancePaise } from "./settlement";

/**
 * P&L semantics (match the prototype):
 * - income = CONVERTED bill totals only (a quotation is not income);
 * - cost = site expenses + attendance wages;
 * - customer advances reduce receivable, never income;
 * - worker payments hit cash, never P&L (wages already did);
 * - shop money is pass-through: in cash/bank balances, NEVER here.
 * Everything derived live; nothing stored.
 */
export interface SitePnl {
  billTotalPaise: number;
  advancesPaise: number;
  receivablePaise: number; // billTotal − advances, may be negative (excess advance)
  expensesPaise: number;
  wagesPaise: number;
  profitPaise: number;
}

export async function siteBillTotalPaise(siteId: string): Promise<number> {
  const bill = await getDocByKind(siteId, "bill");
  if (!bill) return 0;
  return documentTotalPaise(await listItems(bill.id));
}

export async function sitePnl(siteId: string): Promise<SitePnl> {
  const [billTotalPaise, advances, expenses, att] = await Promise.all([
    siteBillTotalPaise(siteId),
    listTxns({ siteId, types: ["customer_advance"] }),
    listTxns({ siteId, types: ["site_expense"] }),
    listAttendance({ siteId }),
  ]);
  const advancesPaise = sumPaise(advances);
  const expensesPaise = sumPaise(expenses);
  const wagesPaise = wagesEarnedPaise(att);
  return {
    billTotalPaise,
    advancesPaise,
    receivablePaise: billTotalPaise - advancesPaise,
    expensesPaise,
    wagesPaise,
    profitPaise: billTotalPaise - (expensesPaise + wagesPaise),
  };
}

export interface OverallPnl {
  incomePaise: number;
  expensesPaise: number;
  wagesPaise: number;
  costPaise: number;
  profitPaise: number;
  marginPct: number; // 0 when income is 0
  perSite: ({ siteId: string; siteName: string } & SitePnl)[];
}

export async function overallPnl(): Promise<OverallPnl> {
  const sites = (await db.sites.toArray()).filter((s) => s.deleted_at === null);
  const perSite = await Promise.all(
    sites.map(async (s) => ({ siteId: s.id, siteName: s.name, ...(await sitePnl(s.id)) })),
  );
  const incomePaise = perSite.reduce((a, p) => a + p.billTotalPaise, 0);
  const expensesPaise = perSite.reduce((a, p) => a + p.expensesPaise, 0);
  const wagesPaise = perSite.reduce((a, p) => a + p.wagesPaise, 0);
  const costPaise = expensesPaise + wagesPaise;
  const profitPaise = incomePaise - costPaise;
  return {
    incomePaise,
    expensesPaise,
    wagesPaise,
    costPaise,
    profitPaise,
    marginPct: incomePaise ? Math.round((profitPaise / incomePaise) * 100) : 0,
    perSite,
  };
}

/** Sum of per-site receivables, each clamped at 0 (excess advance ≠ negative). */
export async function totalReceivablePaise(): Promise<number> {
  const { perSite } = await overallPnl();
  return perSite.reduce((a, p) => a + Math.max(0, p.receivablePaise), 0);
}

export async function activeSitesCount(): Promise<number> {
  const sites = await db.sites.toArray();
  return sites.filter((s) => s.deleted_at === null && s.status === "Active").length;
}

/** Workers with a positive balance payable. */
export async function workersDueCount(): Promise<number> {
  const employees = (await db.employees.toArray()).filter((e) => e.deleted_at === null);
  const balances = await Promise.all(employees.map((e) => empBalancePaise(e.id)));
  return balances.filter((b) => b > 0).length;
}
