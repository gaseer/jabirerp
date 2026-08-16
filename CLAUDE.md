# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Power Plus — offline-first contractor ERP PWA for a solo contractor in Kerala. Sites, quotations/bills (PDF), customer/worker/shop ledgers, attendance & hourly wages, expenses, P&L. Package name is `powerplus`; repo dir is `jabir_erp`.

## Commands

```bash
npm run dev          # Vite dev server
npm run build        # tsc -b && vite build
npm test             # vitest run (all tests)
npm run test:watch   # vitest watch mode
npx vitest run src/domain/pnl.test.ts        # single test file
npx vitest run -t "settles"                  # tests matching name
npm run preview      # serve built app on port 4599
```

Tests use `fake-indexeddb` (see `src/test/setup.ts`) so Dexie-backed code is testable in Node. No lint script is configured.

Supabase credentials come from `.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`); the app still runs offline without them, but auth/sync fail.

## Architecture

**Local-first sync engine** — the core design; everything else hangs off it:

- **Dexie (IndexedDB) is the source of truth.** All reads come from Dexie. Writes go to Dexie first and are queued in an `outbox` table.
- **`Repo` interface (`src/repo/Repo.ts`) is the sync boundary.** UI and domain code talk only to repos (`src/repo/repos.ts`); nothing outside `src/repo/` calls Supabase directly.
- **`SupabaseSync` (`src/repo/SupabaseSync.ts`)** drains the outbox (push → upsert, clears `_dirty`), then pulls by per-table `updated_at` cursor stored in Dexie `meta`. Last-write-wins, but dirty local rows are protected from being overwritten by pull. Triggered on reconnect/mount via `useSyncEngine`.
- **`SYNC_TABLES` in `src/repo/syncRegistry.ts`** maps table name → Dexie table. Order matters: FK parents before children (pull delivers parents first).
- Every synced row extends `BaseEntity`: client-generated UUID `id`, `owner_id` (= `auth.uid()`, enforced by RLS), `created_at`/`updated_at`, `deleted_at` (soft delete — never hard-delete history), `_dirty` flag.
- Server side: `updated_at` is set by a Postgres trigger (server-authoritative, keeps the pull cursor reliable). RLS on every table.

**Adding a synced entity** touches all of: Dexie schema version bump in `src/lib/db.ts` → row type + repo in `src/repo/repos.ts` → entry in `SYNC_TABLES` → new SQL migration in `supabase/migrations/`. Migrations are plain SQL applied manually to Supabase (not via CLI); each schema change ships its migration in the same slice.

**Documents** — one `documents` table, three kinds. `quotation` → `bill` is the convert flow (at most one of each per site). `invoice` is the **direct bill**: many per site, numbered from one running book across all sites (`INV-0001`), with `doc_date`/`title`/`notes`/`discount_paise` on the header and `section`/`unit` on each line. Income (`siteBillTotalPaise`) = the converted bill + every invoice, each net of its discount; a quotation is never income.

**Domain layer (`src/domain/`)** — pure derivation over Dexie rows. Ledgers, balances, settlements, and P&L are always computed, never stored. Each module has a colocated `.test.ts`. Pages (`src/pages/`) call domain functions + repos via TanStack Query.

**Single `transactions` table** holds all money movement, typed `customer_advance | site_expense | worker_payment | shop_in | shop_out`. Direction (`in`/`out`) is derived from type (`txnDirection`), never stored. Worker and shop transactions carry **no** `site_id`. Shops are pass-through accounts — they never enter P&L.

**Wages** — hourly model: `employees.hourly_wage_paise`; attendance stores a from/to shift as zero-padded `"HH:MM"` 24h text, plus `hours` and a `wage_paise` snapshot computed once at write time. `hoursBetween` (`src/domain/wages.ts`) wraps past midnight when `end < start`, so overnight shifts are allowed and stored under the start date; equal start/end stays a rejected zero-length shift. Historical wage rows are never recomputed when the hourly rate changes.

## Invariants

- **Offline-first UI:** the QueryClient uses `networkMode: "always"` (queries/mutations read Dexie, never the network) — removing it makes all data vanish when offline. Auth falls back to a localStorage-cached user (`powerplus-last-user`) when offline, so an expired token can't lock the user out of local data.

- **Outbox resilience (`SupabaseSync.push`):** a failing row skips only its own table's queue; duplicate row snapshots coalesce to the newest; items whose `owner_id` ≠ current user are dropped (they can never pass RLS). Pull paginates (1000-row Supabase cap) and compares timestamps as epoch ms — Postgres returns `+00:00`, local writes `Z`; never compare lexically.

- **Money = integer paise everywhere** (storage, math, domain). Format to ₹ only at display via `formatPaise` (`src/lib/money.ts`). Round once, at write time.
- **Financial rows are append-only + soft-delete.** Corrections are new rows, not edits.
- **Brand identity lives in `src/lib/brand.ts`** — trading name (`POWER PLUS` / `ELECTRICAL AND PLUMBING WORKS`), contact lines, palette, and the logo assets. Nothing else hardcodes the name. `loadBrandLogo()` memoises the mark as a data URL for jsPDF and resolves `null` on failure, so a PDF never fails to generate over a missing image.
- **PDFs** (`src/lib/pdf.ts`, `src/lib/statementPdf.ts`): jsPDF + autotable are dynamically imported to keep the main bundle small — keep it that way. jsPDF's font can't render `₹` or `−`, so PDFs use `formatPaisePdf` ("Rs", ASCII hyphen). All four documents share `drawLetterhead` / `drawPartyBlock` / `tableTheme` / `drawClosing` / `paintFooters` — build new documents from those, don't hand-roll a header. `src/lib/pdfPreview.test.ts` (skipped by default) renders real PDFs to disk for eyeballing a layout change. PDFs are customer-facing: no internal data.
- **TanStack Query gotcha:** `queryFn` must never resolve `undefined` — coalesce getById-style results to `null`.

## Working conventions

- Project was built in vertical slices, each ending at a human review gate. When adding a feature, deliver it end-to-end (Dexie + migration + domain + tests + UI) and stop for review rather than batching multiple features.
- `VERIFICATION.md` at repo root is the manual QA checklist the user runs; update it when behavior changes.
- `powerplus.html` at repo root is a vanilla-JS design-reference prototype (palette/nav source). Keep it; don't delete or lint it.
