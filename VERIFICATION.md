# Power Plus — MVP Verification Checklist

Slices 3–11 built in one batch. Everything below needs a human pass before
calling MVP done. Automated: `npm test` (78 tests) and `npm run build` both green.

## 0. One-time setup

- [x] SQL migrations 0001–0007 applied (verified 2026-07-15: every table pulls 200 from Supabase).
  - ⚠️ That check was too weak: `employees`/`attendance` still had the PRE-revision 0005 shape (`daily_wage_paise`, `unit`) — `select *` returns 200 either way, but every push failed on the missing `hourly_wage_paise`/`start_time` columns, so workers never synced across devices.
- [ ] **Apply `0008_hourly_wages_server.sql`** (Supabase SQL editor). Verify columns exist:
  `GET /rest/v1/employees?select=hourly_wage_paise&limit=1` and
  `GET /rest/v1/attendance?select=start_time&limit=1` both return 200 (they returned 400/42703 before).
- [ ] After 0008: add a worker on one device → Sync → worker appears on a second device (this was the broken path). Existing un-pushed workers drain from the outbox on next sync.
- [ ] `src/lib/pdf.ts` → set `BRAND_PHONE` to the contractor's real phone number (currently `""`, hidden when empty).

## 0.5 Offline hardening (added 2026-07-15 — verified in-browser)

- [x] Queries run from Dexie even while offline (`networkMode: "always"`) — data no longer vanishes when the network drops.
- [x] Last signed-in user cached in localStorage — an expired token + offline no longer bounces to the Login screen.
- [x] Outbox: one bad row only blocks its own table, never the whole queue; duplicate snapshots of a row coalesce to the newest; items queued under a different account are dropped (they can never pass RLS).
- [x] Pull paginates past Supabase's 1000-row cap and compares timestamps as epoch ms (Postgres `+00:00` vs local `Z`).
- [ ] Real-device pass: airplane mode → app opens from home screen, all pages show data, new entries save; disable airplane mode → header sync drains the outbox.

## 1. Offline-first sync round-trips

- [ ] DevTools → Network → Offline. Add an advance, an expense, attendance, a worker payment, a shop txn, a task. All appear instantly in the UI; header shows "Offline"; outbox grows (Dexie `outbox` table).
- [ ] Go online → Sync. Outbox drains to 0. Rows appear in Supabase with correct `owner_id`.
- [ ] Second browser profile, same login → all data pulls down and every derived number matches.
- [ ] **Parent + child offline in one session**: create a NEW worker offline, then mark attendance + payment for them offline, reconnect → parent pushes first (outbox is chronological), no FK error halts the queue. Repeat with a new shop + shop txn.
- [ ] Edit the same site name in two profiles while one is offline → last write wins on reconnect, no crash, no duplicate.

## 2. Poison-pill guard (each money form)

- [ ] Amount `0`, negative, or blank → form shows an error, nothing saved, **outbox count unchanged** (check Dexie). This is the critical invariant: a CHECK-rejected row would wedge the whole outbox.
- [ ] Attendance with end time ≤ start time, or malformed times → rejected client-side.
- [ ] Confirm in Supabase: no row ever arrives that violates the CHECKs (spot-check `transactions` rows have the right shape per type — e.g. `worker_payment` has NULL site_id/shop_id/category).

## 3. PDFs (3 shareable documents)

For each of: **Quotation/Bill** (site → Quotation/Bill tab), **Advance statement** (site → Advances tab), **Settlement statement** (worker → Settlement tab):

- [ ] Desktop: downloads as a file (share falls back to download). Mobile PWA: native share sheet opens.
- [ ] **Money renders as `Rs 12,500`** — never `₹` garbage glyphs (jsPDF built-in font can't do U+20B9/U+2212). Negative = ASCII hyphen.
- [ ] Amounts on the PDF exactly match the on-screen list for the same date range.
- [ ] Set a date range → **table rows change, but the summary block does NOT** (summary is lifetime "as of today" — advance statement: Bill total / Total received to date / Balance due; settlement: Opening / Wages / Paid / Balance payable where opening + wages − paid = balance).
- [ ] Txn dated exactly on `from` and exactly on `to` appears in BOTH the list and the PDF (inclusive edges).
- [ ] Site with no converted bill → advance statement omits Bill total / Balance due rows.
- [ ] Airplane mode after first load → PDF generation still works (chunk precached by PWA).
- [ ] Statement header shows "Power Plus" + phone; period label reads "All time" when unfiltered.

### 3a. Excel export (📊 button next to each 📄 Share button)

- [ ] Each of the 3 documents also has a **Share Excel** button; it opens the same share sheet / download but as an `.xlsx` file.
- [ ] Open the file: money is a **real number cell** (rupees) — `=SUM()` over an Amount/Wage column works; whole rupees show `12,500`, fractions `125.5` (no `₹` symbol needed in a spreadsheet).
- [ ] Content matches the PDF exactly for the same date range: same rows, same section headings (Attendance / Payments / Line items), same summary values.
- [ ] The `#` index and the Time column stay text; Hours reads as its label (e.g. "8h"), not currency.
- [ ] Airplane mode after first load → Excel generation still works (xlsx chunk is lazy-loaded + PWA-precached).

## 4. Money invariants (cross-screen consistency)

- [ ] Dashboard Cash + Bank tiles ≡ Ledger stat cards ≡ manual sum of unfiltered ledger rows (in = +, out = −, split by mode).
- [ ] Site Overview profit ≡ same site's card on Reports.
- [ ] Ledger filters (site/type/mode/date) change the LIST but never the cash/bank stat cards.
- [ ] Shop txns: visible in Ledger and in cash/bank, **absent from Reports P&L** and site Overview expenses.
- [ ] Site filter on Ledger includes that site's shop txns (matched through the shop's linked site).
- [ ] Delete an advance → site receivable goes back UP; dashboard "To receive" follows.
- [ ] Delete an expense/attendance/payment → profit, wages, worker balance all update simultaneously.
- [ ] Overpay a site (advance > bill): its Overview receivable goes negative, but dashboard "To receive" clamps that site at 0 (other sites unaffected).
- [ ] Overpay a worker: balance shows as "advance given", Workers-due tile excludes them.
- [ ] Delete a site that has transactions → warned; site vanishes from lists/Reports/receivable, but its txns stay in Ledger + cash/bank (labels still show the name).
- [ ] Same for a worker with balance ≠ 0 and a shop with holding ≠ 0 (both get a warning first).

## 5. Wages & settlement math (HOURLY model)

- [ ] Wage is ₹/hour; attendance = from/to time pickers. 1:00 PM–3:00 PM at ₹100/hr = ₹200; 12:30 PM–5:30 PM = 5h = ₹500. Form shows a live "hours × rate = wage" preview.
- [ ] End time ≤ start time → inline error, submit disabled, nothing saved, nothing queued (poison-pill guard covers attendance too — server CHECK `end_time > start_time`).
- [ ] Edit a worker's hourly wage → past attendance amounts UNCHANGED (snapshot at write); new attendance uses the new wage. UI notes this on the edit form.
- [ ] Two NON-overlapping shifts same day (two sites) allowed; form shows the duplicate-day hint with each shift's time range.
- [ ] Marking a shift that overlaps an existing one (same worker, same date — including an exact duplicate re-submit) → "Already marked …" error, nothing saved, nothing queued. Works from both the Worker detail form and the Site Workers tab.
- [ ] Settlement PDF attendance section shows Time (e.g. "1:00 PM – 3:00 PM") + Hours columns; totals match on-screen.
- [ ] Pre-existing local data from the daily-wage build (if any): app upgrade converts wage to hourly (÷8) and old entries to synthetic 9:00 AM shifts — recorded wage amounts unchanged.
- [ ] Settlement with range: opening balance = everything strictly before `from`; opening + period wages − period paid = balance payable (check the arithmetic on-screen).
- [ ] Attendance filters by work date, payments by payment date (mark attendance dated June, pay in July, range July → wages 0, paid > 0).

## 6. Per-screen smoke test

- [ ] **Dashboard**: 8 tiles (To receive amber, Cash red-if-negative, Bank, Shop money, Active sites, Workers due, Net profit green/red, Total billed), quick actions navigate, Recent activity = last 6 ledger rows.
- [ ] **Sites → detail**: 6 tabs (Overview | Quotation/Bill | Advances | Expenses | Workers | Tasks); `?tab=` survives refresh; unknown tab falls back to Overview.
- [ ] **Quotation/Bill regression** (pure move — must behave EXACTLY as before): add/edit/remove line items, totals, share PDF, convert to bill (quotation view replaced by bill after convert).
- [ ] **Advances/Expenses tabs**: add + soft-delete only (NO edit on money rows — correction = delete + re-add), period totals, expense category select.
- [ ] **Site Workers tab**: per-worker hours worked + wages for THIS site only; mark-attendance (time pickers + wage preview) preselects the site.
- [ ] **Tasks tab**: add, toggle check/strikethrough, delete, "No pending works 🎉" empty state, oldest first.
- [ ] **Workers page**: card shows role, wage/hr, balance (amber payable / green settled / "advance given"); detail has Attendance | Payments | Settlement tabs.
- [ ] **Ledger**: IN/OUT badges, Cash/Bank tags, party names (site · category for expenses), filters + Clear-all.
- [ ] **Shops**: total-holding stat, per-shop Received/Paid/Holding, Pending/Cleared pill, "Pay shop" prefills the pending amount, site link navigates.
- [ ] **Reports**: overall income-vs-cost bars, margin %, per-site cards, "Shop money excluded" subtitle. Income counts ONLY converted bills (site with unconverted quotation contributes 0).
- [ ] **Nav**: 6 items incl. P&L 📊, mobile bottom bar not cramped (grid-cols-6).

## 7. Timezone

- [ ] Set system clock to 00:30 IST (or any time before 05:30) → new txn/attendance default date = the LOCAL day, not yesterday (todayIso uses local date parts, never toISOString).

## 8. Dexie migration safety

- [ ] Open the app with pre-existing local data from slices 0–2 (Dexie v3) → upgrades to v7 silently, sites/documents intact, no console errors.
