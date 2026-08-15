import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AttendanceStatus, EmployeeRow } from "@/lib/db";
import { employeeRepo } from "@/repo/repos";
import { SYNC_DONE_EVENT, sync } from "@/repo/SupabaseSync";
import { useOnline } from "@/hooks/useOnline";
import { refreshWorkerSiteCache, listWorkerSiteCache } from "@/repo/workerSites";
import { listAttendance, markSelfAttendance } from "@/domain/attendance";
import { listTxns, sumPaise } from "@/domain/transactions";
import { buildSettlement } from "@/domain/settlement";
import { attendanceWagePaise, hoursBetween, hoursLabel, isValidTime, timeRangeLabel } from "@/domain/wages";
import { shareSettlementPdf } from "@/lib/statementPdf";
import { shareSettlementXlsx } from "@/lib/xlsx";
import { formatPaise } from "@/lib/money";
import { formatDate, todayIso, type DateRange } from "@/lib/dates";
import { useAuth } from "@/store/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ModeTag } from "@/components/ModeTag";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { cn } from "@/lib/utils";

const pushSoon = () => sync.sync().catch(() => {});

const TABS = [
  { key: "attendance", label: "Attendance" },
  { key: "payments", label: "Payments" },
  { key: "settlement", label: "Settlement" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function StatusPill({ status }: { status: AttendanceStatus }) {
  if (status === "approved") return null;
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold",
        status === "pending" ? "bg-amber-soft text-amber" : "bg-red-soft text-red",
      )}
    >
      {status === "pending" ? "Pending approval" : "Rejected"}
    </span>
  );
}

/**
 * Self-service worker app: their own attendance/payments/settlement, nothing
 * else. Site names come only from worker_site_cache (populated via the
 * worker_site_names RPC) — the sites table itself is unreachable under this
 * session's RLS.
 */
export function WorkerHome() {
  const employeeId =
    (useAuth((s) => s.user?.user_metadata?.employee_id) as string | undefined) ?? "";
  const [tab, setTab] = useState<TabKey>("attendance");

  const { data: worker, isFetched } = useQuery({
    queryKey: ["me", employeeId],
    queryFn: async () => (await employeeRepo.getById(employeeId)) ?? null,
    enabled: Boolean(employeeId),
  });

  const { data: sites = [] } = useQuery({
    queryKey: ["worker-site-cache"],
    queryFn: async () => {
      await refreshWorkerSiteCache();
      return listWorkerSiteCache();
    },
  });
  const siteName = new Map(sites.map((s) => [s.id, s.name]));

  // The employee row is a Dexie read, so on a fresh sign-in it is legitimately
  // absent until the first pull lands. Waiting for one completed sync is what
  // separates "not here YET" from "not coming" — without it this screen used
  // to show "Loading…" forever whenever the row never arrived.
  const syncSettled = useSyncSettled();
  const resolved = employeeId ? isFetched : true;

  if (!worker) {
    if (!syncSettled || !resolved) return <Card className="text-muted">Loading…</Card>;
    return <WorkerRecordMissing />;
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-sm bg-border/40 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex-1 rounded-sm px-3 py-1.5 text-sm font-medium",
              tab === t.key ? "bg-surface text-primary shadow-card" : "text-muted",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "attendance" && (
        <MyAttendanceTab worker={worker} sites={sites} siteName={siteName} />
      )}
      {tab === "payments" && <MyPaymentsTab worker={worker} />}
      {tab === "settlement" && <MySettlementTab worker={worker} siteName={siteName} />}
    </div>
  );
}

/** True once at least one sync round has completed since mount (the event
 *  fires even offline, where sync() is a no-op — that IS a settled answer). */
function useSyncSettled(): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const done = () => setSettled(true);
    window.addEventListener(SYNC_DONE_EVENT, done);
    return () => window.removeEventListener(SYNC_DONE_EVENT, done);
  }, []);
  return settled;
}

/**
 * Terminal state instead of an endless spinner: the signed-in identity has no
 * worker record to show. Either the contractor removed/renamed them (sign in
 * again to re-resolve — claim_employee re-checks name+phone), or this device
 * has never been online since sign-in and has nothing cached.
 */
function WorkerRecordMissing() {
  const online = useOnline();
  const signOut = useAuth((s) => s.signOut);

  return (
    <Card className="space-y-3">
      <div className="font-semibold">Can't load your details</div>
      {online ? (
        <>
          <p className="text-sm text-muted">
            Your worker record isn't available for this login. Ask your contractor to
            check you are still listed with this exact name and phone number, then sign
            in again.
          </p>
          <Button size="sm" variant="soft" onClick={signOut}>
            Sign in again
          </Button>
        </>
      ) : (
        <p className="text-sm text-muted">
          You're offline and your details aren't saved on this device yet. Connect to the
          internet once, then reopen the app.
        </p>
      )}
    </Card>
  );
}

const BLANK_SHIFT = { siteId: "", date: todayIso(), start: "09:00", end: "17:00" };

function MyAttendanceTab({
  worker,
  sites,
  siteName,
}: {
  worker: EmployeeRow;
  sites: { id: string; name: string }[];
  siteName: Map<string, string>;
}) {
  const qc = useQueryClient();
  const [range, setRange] = useState<DateRange>({});
  const [form, setForm] = useState(BLANK_SHIFT);
  const [err, setErr] = useState<string | null>(null);

  const { data: rows = [] } = useQuery({
    queryKey: ["my-attendance", worker.id, range],
    queryFn: () => listAttendance({ employeeId: worker.id, ...range }),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["my-attendance", worker.id] });
    qc.invalidateQueries({ queryKey: ["my-settlement", worker.id] });
  };

  const mark = useMutation({
    mutationFn: () =>
      markSelfAttendance({
        employeeId: worker.id,
        siteId: form.siteId,
        workDate: form.date,
        startTime: form.start,
        endTime: form.end,
      }),
    onSuccess: () => {
      pushSoon();
      setErr(null);
      setForm(BLANK_SHIFT);
      refresh();
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Could not save"),
  });

  const sameDay = rows.filter((r) => r.work_date === form.date);
  const timesValid = isValidTime(form.start) && isValidTime(form.end);
  const previewHours = timesValid ? hoursBetween(form.start, form.end) : 0;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.siteId) {
      setErr("Pick a site");
      return;
    }
    mark.mutate();
  }

  return (
    <div className="space-y-3">
      <Card className="space-y-3">
        <div className="font-semibold">Mark attendance</div>
        {sites.length === 0 && (
          <p className="text-sm text-muted">
            No sites available yet — connect once online, or check with your contractor.
          </p>
        )}
        <form onSubmit={submit} className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={form.siteId}
              onChange={(e) => setForm({ ...form, siteId: e.target.value })}
            >
              <option value="">Site…</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <Input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-muted">
              From
              <Input
                type="time"
                className="mt-1"
                value={form.start}
                onChange={(e) => setForm({ ...form, start: e.target.value })}
                required
              />
            </label>
            <label className="text-xs text-muted">
              To
              <Input
                type="time"
                className="mt-1"
                value={form.end}
                onChange={(e) => setForm({ ...form, end: e.target.value })}
                required
              />
            </label>
          </div>
          {previewHours > 0 ? (
            <p className="text-sm text-muted">
              {hoursLabel(previewHours)} × {formatPaise(worker.hourly_wage_paise)}/hr ={" "}
              <span className="font-semibold text-text">
                {formatPaise(attendanceWagePaise(worker.hourly_wage_paise, previewHours))}
              </span>
            </p>
          ) : (
            <p className="text-sm text-red">End time must be after start time.</p>
          )}
          {sameDay.length > 0 && (
            <p className="text-xs text-amber">
              Already marked on {formatDate(form.date)}:{" "}
              {sameDay
                .map((r) => `${siteName.get(r.site_id) ?? "?"} (${timeRangeLabel(r.start_time, r.end_time)})`)
                .join(", ")}
            </p>
          )}
          {err && <p className="text-sm text-red">{err}</p>}
          <Button type="submit" size="sm" disabled={mark.isPending || previewHours <= 0}>
            Submit for approval
          </Button>
        </form>
      </Card>

      <Card className="space-y-3">
        <div className="font-semibold">My attendance</div>
        <DateRangeFilter range={range} onChange={setRange} />
        {rows.length === 0 ? (
          <p className="text-sm text-muted">No attendance in this period.</p>
        ) : (
          <div className="divide-y divide-border">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span>
                      {formatDate(r.work_date)} · {hoursLabel(r.hours)}
                    </span>
                    <StatusPill status={r.status} />
                  </div>
                  <div className="truncate text-xs text-muted">
                    {timeRangeLabel(r.start_time, r.end_time)} ·{" "}
                    {siteName.get(r.site_id) ?? "Unknown site"}
                  </div>
                </div>
                <div className="font-semibold">{formatPaise(r.wage_paise)}</div>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between border-t border-border pt-2 font-semibold">
          <span>Wages (period, approved only)</span>
          <span>
            {formatPaise(
              rows.filter((r) => r.status === "approved").reduce((s, r) => s + r.wage_paise, 0),
            )}
          </span>
        </div>
      </Card>
    </div>
  );
}

function MyPaymentsTab({ worker }: { worker: EmployeeRow }) {
  const [range, setRange] = useState<DateRange>({});

  const { data: txns = [] } = useQuery({
    queryKey: ["my-payments", worker.id, range],
    queryFn: () => listTxns({ employeeId: worker.id, types: ["worker_payment"], ...range }),
  });

  return (
    <Card className="space-y-3">
      <div className="font-semibold">Payment history</div>
      <DateRangeFilter range={range} onChange={setRange} />
      {txns.length === 0 ? (
        <p className="text-sm text-muted">No payments in this period.</p>
      ) : (
        <div className="divide-y divide-border">
          {txns.map((t) => (
            <div key={t.id} className="flex items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{formatDate(t.txn_date)}</span>
                  <ModeTag mode={t.mode} />
                </div>
                {t.note && <div className="truncate text-xs text-muted">{t.note}</div>}
              </div>
              <div className="font-semibold text-red">{formatPaise(t.amount_paise)}</div>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between border-t border-border pt-2 font-semibold">
        <span>Paid (period)</span>
        <span className="text-red">{formatPaise(sumPaise(txns))}</span>
      </div>
    </Card>
  );
}

function MySettlementTab({
  worker,
  siteName,
}: {
  worker: EmployeeRow;
  siteName: Map<string, string>;
}) {
  const [range, setRange] = useState<DateRange>({});

  const { data: settlement } = useQuery({
    queryKey: ["my-settlement", worker.id, range],
    queryFn: () => buildSettlement(worker.id, range),
  });

  async function share() {
    if (!settlement) return;
    await shareSettlementPdf(worker, settlement, range, siteName);
  }

  async function shareExcel() {
    if (!settlement) return;
    await shareSettlementXlsx(worker, settlement, range, siteName);
  }

  if (!settlement) return <Card className="text-muted">Loading…</Card>;

  const rows = [
    { k: "Opening balance", v: settlement.openingBalancePaise },
    { k: "Wages this period", v: settlement.periodWagesPaise },
    { k: "Paid this period", v: settlement.periodPaidPaise, neg: true },
  ];

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-semibold">Settlement</div>
        <div className="flex gap-2">
          <Button size="sm" variant="soft" onClick={share}>
            📄 PDF
          </Button>
          <Button size="sm" variant="soft" onClick={shareExcel}>
            📊 Excel
          </Button>
        </div>
      </div>
      <DateRangeFilter range={range} onChange={setRange} />

      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.k} className="flex items-center justify-between py-1.5">
            <span className="text-sm text-muted">{r.k}</span>
            <span className={cn("font-semibold", r.neg && "text-red")}>{formatPaise(r.v)}</span>
          </div>
        ))}
        <div className="flex items-center justify-between border-t border-border pt-2">
          <span className="font-semibold">Balance payable</span>
          <span
            className={cn(
              "text-lg font-bold",
              settlement.closingBalancePaise > 0 ? "text-amber" : "text-green",
            )}
          >
            {formatPaise(settlement.closingBalancePaise)}
          </span>
        </div>
        {settlement.closingBalancePaise < 0 && (
          <p className="text-xs text-muted">
            Negative balance = advance given (paid more than earned so far).
          </p>
        )}
      </div>
    </Card>
  );
}
