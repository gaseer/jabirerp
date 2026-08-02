import { useState, type FormEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AttendanceStatus, EmployeeRow, TxnMode } from "@/lib/db";
import { attendanceRepo, employeeRepo, siteRepo, transactionRepo } from "@/repo/repos";
import { sync } from "@/repo/SupabaseSync";
import {
  approveAttendance,
  editAttendance,
  listAttendance,
  markAttendance,
  rejectAttendance,
} from "@/domain/attendance";
import { addWorkerPayment, listTxns, sumPaise } from "@/domain/transactions";
import { buildSettlement } from "@/domain/settlement";
import {
  attendanceWagePaise,
  hoursBetween,
  hoursLabel,
  isValidTime,
  timeRangeLabel,
} from "@/domain/wages";
import { shareSettlementPdf } from "@/lib/statementPdf";
import { shareSettlementXlsx } from "@/lib/xlsx";
import { formatPaise, paiseToRupees, toPaise } from "@/lib/money";
import { WageRoundEditor } from "@/components/WageRoundEditor";
import { formatDate, todayIso, type DateRange } from "@/lib/dates";
import { useEntryMode } from "@/store/settings";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { ModeTag } from "@/components/ModeTag";
import { ModeToggle } from "@/components/ModeToggle";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { EntryGrid } from "@/components/grid/EntryGrid";
import { MODE_OPTIONS, sumRupeeColumn } from "@/components/grid/gridHelpers";
import type { GridColumn, GridRow } from "@/components/grid/SheetGrid";
import { cn } from "@/lib/utils";

const pushSoon = () => sync.sync().catch(() => {});

/** Approved shifts show no pill (the common case) — pending/rejected stand out. */
function AttendanceStatusPill({ status }: { status: AttendanceStatus }) {
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

const TABS = [
  { key: "attendance", label: "Attendance" },
  { key: "payments", label: "Payments" },
  { key: "settlement", label: "Settlement" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function WorkerDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const rawTab = params.get("tab") ?? "attendance";
  const tab: TabKey = TABS.some((t) => t.key === rawTab) ? (rawTab as TabKey) : "attendance";

  const { data: worker } = useQuery({
    queryKey: ["worker", id],
    queryFn: async () => (await employeeRepo.getById(id)) ?? null,
  });

  return (
    <div className="space-y-4">
      <button className="text-primary" onClick={() => navigate("/workers")}>
        ← Workers
      </button>

      {worker === null ? (
        <Card className="text-muted">Worker not found.</Card>
      ) : worker ? (
        <>
          <div>
            <h2 className="text-xl font-bold">{worker.name}</h2>
            <p className="text-sm text-muted">
              {worker.role} · {formatPaise(worker.hourly_wage_paise)}/hr
              {worker.phone ? ` · ${worker.phone}` : ""}
            </p>
          </div>

          <div className="flex gap-1 rounded-sm bg-border/40 p-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setParams({ tab: t.key }, { replace: true })}
                className={cn(
                  "flex-1 rounded-sm px-3 py-1.5 text-sm font-medium",
                  tab === t.key ? "bg-surface text-primary shadow-card" : "text-muted",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "attendance" && <AttendanceTab worker={worker} />}
          {tab === "payments" && <PaymentsTab worker={worker} />}
          {tab === "settlement" && <SettlementTab worker={worker} />}
        </>
      ) : (
        <Card className="text-muted">Loading…</Card>
      )}
    </div>
  );
}

const BLANK_SHIFT = { siteId: "", date: todayIso(), start: "09:00", end: "17:00" };

function AttendanceTab({ worker }: { worker: EmployeeRow }) {
  const qc = useQueryClient();
  const excel = useEntryMode() === "excel";
  const [range, setRange] = useState<DateRange>({});
  const [form, setForm] = useState(BLANK_SHIFT);
  // Non-null = the form is editing that existing entry instead of adding one.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Wage round-off override for the add/edit form; "" = use the computed wage.
  const [wageOverride, setWageOverride] = useState("");
  // Non-null = the approve modal is open for that pending row.
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approveWageOverride, setApproveWageOverride] = useState("");

  const { data: sites = [] } = useQuery({
    queryKey: ["sites"],
    queryFn: () => siteRepo.getAll(),
  });
  const siteName = new Map(sites.map((s) => [s.id, s.name]));

  const { data: rows = [] } = useQuery({
    queryKey: ["worker-attendance", worker.id, range],
    queryFn: () => listAttendance({ employeeId: worker.id, ...range }),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["worker-attendance", worker.id] });
    qc.invalidateQueries({ queryKey: ["employee-balances"] });
  };

  const mark = useMutation({
    mutationFn: () => {
      const input = {
        employeeId: worker.id,
        siteId: form.siteId,
        workDate: form.date,
        startTime: form.start,
        endTime: form.end,
      };
      const override = wageOverride.trim() ? toPaise(wageOverride) : undefined;
      return editingId
        ? editAttendance(editingId, input, override)
        : markAttendance(input, override);
    },
    onSuccess: () => {
      pushSoon();
      setErr(null);
      if (editingId) cancelEdit();
      else setWageOverride("");
      refresh();
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Could not save"),
  });

  function startEdit(row: (typeof rows)[number]) {
    setEditingId(row.id);
    setErr(null);
    setForm({
      siteId: row.site_id,
      date: row.work_date,
      start: row.start_time,
      end: row.end_time,
    });
    // Pre-fill with the currently stored wage so an unrelated edit (e.g. date)
    // doesn't silently discard a rounding the contractor already applied.
    setWageOverride(String(paiseToRupees(row.wage_paise)));
  }

  function cancelEdit() {
    setEditingId(null);
    setErr(null);
    setForm(BLANK_SHIFT);
    setWageOverride("");
  }

  const remove = useMutation({
    mutationFn: async (rowId: string) => {
      await attendanceRepo.softDelete(rowId);
      pushSoon();
    },
    onSuccess: (_void, rowId) => {
      if (editingId === rowId) cancelEdit(); // don't leave the form editing a deleted row
      refresh();
    },
  });

  const approve = useMutation({
    mutationFn: async ({ id, override }: { id: string; override?: number }) => {
      await approveAttendance(id, override);
      pushSoon();
    },
    onSuccess: () => {
      setApprovingId(null);
      setApproveWageOverride("");
      refresh();
    },
  });

  const reject = useMutation({
    mutationFn: async (rowId: string) => {
      await rejectAttendance(rowId);
      pushSoon();
    },
    onSuccess: refresh,
  });

  // Duplicate guard: surface existing entries for the chosen date. The entry
  // being edited is not a duplicate of itself, so it never shows here.
  const sameDay = rows.filter((r) => r.work_date === form.date && r.id !== editingId);

  // Live preview: hours + wage the entry will store.
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

  const shiftForm = (
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
        <div className="space-y-1.5 rounded-sm bg-border/30 p-2">
          <p className="text-xs text-muted">
            {hoursLabel(previewHours)} × {formatPaise(worker.hourly_wage_paise)}/hr ={" "}
            {formatPaise(attendanceWagePaise(worker.hourly_wage_paise, previewHours))}
          </p>
          <WageRoundEditor
            computedPaise={attendanceWagePaise(worker.hourly_wage_paise, previewHours)}
            value={wageOverride}
            onChange={setWageOverride}
          />
        </div>
      ) : (
        <p className="text-sm text-red">End time must be after start time.</p>
      )}
      {sameDay.length > 0 && (
        <p className="text-xs text-amber">
          Already marked on {formatDate(form.date)}:{" "}
          {sameDay
            .map(
              (r) =>
                `${siteName.get(r.site_id) ?? "?"} (${timeRangeLabel(r.start_time, r.end_time)})`,
            )
            .join(", ")}
        </p>
      )}
      {err && <p className="text-sm text-red">{err}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={mark.isPending || previewHours <= 0}>
          {editingId ? "✓ Save changes" : "✓ Mark attendance"}
        </Button>
        {editingId && (
          <Button type="button" size="sm" variant="soft" onClick={cancelEdit}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );

  // Excel mode: mark several shifts at once (site fixed per row, worker fixed).
  const rowWagePaise = (r: GridRow) => {
    if (!isValidTime(r.start) || !isValidTime(r.end)) return 0;
    const h = hoursBetween(r.start, r.end);
    return h > 0 ? attendanceWagePaise(worker.hourly_wage_paise, h) : 0;
  };
  // Blank/unparsable override -> fall back to the computed wage for that row.
  const rowWageOverridePaise = (r: GridRow) => {
    const raw = (r.wage ?? "").trim();
    return raw ? toPaise(raw) : null;
  };
  const rowFinalWagePaise = (r: GridRow) => rowWageOverridePaise(r) ?? rowWagePaise(r);
  const attendanceColumns: GridColumn[] = [
    {
      key: "site",
      label: "Site",
      type: "select",
      placeholder: "Site…",
      options: sites.map((s) => ({ value: s.id, label: s.name })),
    },
    { key: "date", label: "Date", type: "date" },
    { key: "start", label: "From", type: "time" },
    { key: "end", label: "To", type: "time" },
    { key: "wage", label: "Round ₹ (optional)", type: "rupee", align: "right" },
  ];
  const attendanceGrid = (
    <EntryGrid
      columns={attendanceColumns}
      blankRow={{ site: "", date: todayIso(), start: "09:00", end: "17:00", wage: "" }}
      isRowBlank={(r) => !r.site}
      computed={{
        label: "Wage",
        render: (r) => {
          const p = rowFinalWagePaise(r);
          return p ? formatPaise(p) : "—";
        },
      }}
      footer={(rows) => (
        <>Total wages: {formatPaise(rows.reduce((s, r) => s + rowFinalWagePaise(r), 0))}</>
      )}
      saveLabel="Save attendance"
      commit={async (rows) => {
        for (const r of rows) {
          if (!r.site) throw new Error("Pick a site in every row");
          if (
            !isValidTime(r.start) ||
            !isValidTime(r.end) ||
            hoursBetween(r.start, r.end) <= 0
          )
            throw new Error("Every row needs From/To times with end after start");
        }
        for (const r of rows) {
          await markAttendance(
            {
              employeeId: worker.id,
              siteId: r.site,
              workDate: r.date || todayIso(),
              startTime: r.start,
              endTime: r.end,
            },
            rowWageOverridePaise(r) ?? undefined,
          );
        }
        pushSoon();
      }}
      onCommitted={() => {
        refresh();
        qc.invalidateQueries({ queryKey: ["site-attendance"] });
        qc.invalidateQueries({ queryKey: ["site-pnl"] });
        qc.invalidateQueries({ queryKey: ["worker-day"] });
      }}
    />
  );

  return (
    <div className="space-y-3">
      {/* Add form inline; editing an existing row opens it in a modal over the
          tapped entry instead of jumping to the top of a long history. */}
      {!editingId && (
        <Card className="space-y-3">
          <div className="font-semibold">Mark attendance</div>
          {excel ? attendanceGrid : shiftForm}
        </Card>
      )}
      <Modal open={editingId !== null} onClose={cancelEdit} title="Edit attendance">
        {editingId && shiftForm}
      </Modal>

      <Modal
        open={approvingId !== null}
        onClose={() => setApprovingId(null)}
        title="Approve attendance"
      >
        {approvingId &&
          (() => {
            const row = rows.find((r) => r.id === approvingId);
            if (!row) return null;
            return (
              <div className="space-y-3">
                <p className="text-sm text-muted">
                  {formatDate(row.work_date)} · {hoursLabel(row.hours)} ·{" "}
                  {timeRangeLabel(row.start_time, row.end_time)} ·{" "}
                  {siteName.get(row.site_id) ?? "Unknown site"}
                </p>
                <WageRoundEditor
                  computedPaise={row.wage_paise}
                  value={approveWageOverride}
                  onChange={setApproveWageOverride}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={approve.isPending}
                    onClick={() =>
                      approve.mutate({
                        id: row.id,
                        override: approveWageOverride.trim()
                          ? toPaise(approveWageOverride)
                          : undefined,
                      })
                    }
                  >
                    ✓ Approve
                  </Button>
                  <Button size="sm" variant="soft" onClick={() => setApprovingId(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            );
          })()}
      </Modal>

      <Card className="space-y-3">
        <div className="font-semibold">Attendance history</div>
        <DateRangeFilter range={range} onChange={setRange} />
        {rows.length === 0 ? (
          <p className="text-sm text-muted">No attendance in this period.</p>
        ) : (
          <div className="divide-y divide-border">
            {rows.map((r) => (
              <div
                key={r.id}
                className={cn(
                  "flex items-center gap-2 py-2",
                  editingId === r.id && "text-primary",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span>
                      {formatDate(r.work_date)} · {hoursLabel(r.hours)}
                    </span>
                    <AttendanceStatusPill status={r.status} />
                  </div>
                  <div className="truncate text-xs text-muted">
                    {timeRangeLabel(r.start_time, r.end_time)} ·{" "}
                    {siteName.get(r.site_id) ?? "Unknown site"}
                  </div>
                </div>
                <div className="font-semibold">{formatPaise(r.wage_paise)}</div>
                {r.status === "pending" && (
                  <>
                    <button
                      className="text-green"
                      aria-label="Approve attendance"
                      onClick={() => {
                        setApprovingId(r.id);
                        setApproveWageOverride("");
                      }}
                    >
                      ✓
                    </button>
                    <button
                      className="text-red"
                      aria-label="Reject attendance"
                      onClick={() => reject.mutate(r.id)}
                    >
                      ✕
                    </button>
                  </>
                )}
                <button
                  className="text-primary"
                  aria-label="Edit attendance"
                  onClick={() => startEdit(r)}
                >
                  ✏️
                </button>
                <button
                  className="text-red"
                  aria-label="Delete attendance"
                  onClick={() => {
                    if (confirm("Delete this attendance entry?")) remove.mutate(r.id);
                  }}
                >
                  🗑
                </button>
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

const PAYMENT_COLUMNS: GridColumn[] = [
  { key: "amount", label: "Amount ₹", type: "rupee", align: "right" },
  { key: "date", label: "Date", type: "date" },
  { key: "mode", label: "Mode", type: "select", width: "96px", options: MODE_OPTIONS },
  { key: "note", label: "Note", type: "text" },
];

function PaymentsTab({ worker }: { worker: EmployeeRow }) {
  const qc = useQueryClient();
  const excel = useEntryMode() === "excel";
  const [range, setRange] = useState<DateRange>({});
  const [form, setForm] = useState({ amount: "", mode: "cash" as TxnMode, date: todayIso(), note: "" });
  const [err, setErr] = useState<string | null>(null);

  const { data: txns = [] } = useQuery({
    queryKey: ["worker-payments", worker.id, range],
    queryFn: () => listTxns({ employeeId: worker.id, types: ["worker_payment"], ...range }),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["worker-payments", worker.id] });
    qc.invalidateQueries({ queryKey: ["employee-balances"] });
  };

  const add = useMutation({
    mutationFn: async () => {
      await addWorkerPayment(worker.id, {
        amountPaise: toPaise(form.amount),
        mode: form.mode,
        txnDate: form.date,
        note: form.note,
      });
      pushSoon();
    },
    onSuccess: () => {
      setForm({ amount: "", mode: "cash", date: todayIso(), note: "" });
      setErr(null);
      refresh();
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Could not save"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await transactionRepo.softDelete(id);
      pushSoon();
    },
    onSuccess: refresh,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    add.mutate();
  }

  return (
    <div className="space-y-3">
      <Card className="space-y-3">
        <div className="font-semibold">Record payment{excel ? "s" : ""}</div>
        <p className="text-xs text-muted">
          Advance or settlement — both are the same payment; the balance works
          itself out.
        </p>
        {excel ? (
          <EntryGrid
            columns={PAYMENT_COLUMNS}
            blankRow={{ amount: "", date: todayIso(), mode: "cash", note: "" }}
            isRowBlank={(r) => (r.amount ?? "").trim() === ""}
            footer={(rows) => <>Total: {sumRupeeColumn(rows, "amount")}</>}
            saveLabel="Save payments"
            commit={async (rows) => {
              if (rows.some((r) => toPaise(r.amount) <= 0))
                throw new Error("Every row needs an amount greater than ₹0");
              for (const r of rows) {
                await addWorkerPayment(worker.id, {
                  amountPaise: toPaise(r.amount),
                  mode: (r.mode || "cash") as TxnMode,
                  txnDate: r.date || todayIso(),
                  note: r.note,
                });
              }
              pushSoon();
            }}
            onCommitted={refresh}
          />
        ) : (
          <form onSubmit={submit} className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="Amount ₹ *"
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                required
              />
              <Input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </div>
            <ModeToggle mode={form.mode} onChange={(mode) => setForm({ ...form, mode })} />
            <Input
              placeholder="Note (optional)"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
            {err && <p className="text-sm text-red">{err}</p>}
            <Button type="submit" size="sm" disabled={add.isPending}>
              ＋ Add payment
            </Button>
          </form>
        )}
      </Card>

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
                <button
                  className="text-red"
                  aria-label="Delete payment"
                  onClick={() => {
                    if (confirm("Delete this payment? The balance will go back up."))
                      remove.mutate(t.id);
                  }}
                >
                  🗑
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between border-t border-border pt-2 font-semibold">
          <span>Paid (period)</span>
          <span className="text-red">{formatPaise(sumPaise(txns))}</span>
        </div>
      </Card>
    </div>
  );
}

function SettlementTab({ worker }: { worker: EmployeeRow }) {
  const [range, setRange] = useState<DateRange>({});

  const { data: settlement } = useQuery({
    queryKey: ["settlement", worker.id, range],
    queryFn: () => buildSettlement(worker.id, range),
  });

  const { data: sites = [] } = useQuery({
    queryKey: ["sites"],
    queryFn: () => siteRepo.getAll(),
  });

  async function share() {
    if (!settlement) return;
    const siteNames = new Map(sites.map((s) => [s.id, s.name]));
    await shareSettlementPdf(worker, settlement, range, siteNames);
  }

  async function shareExcel() {
    if (!settlement) return;
    const siteNames = new Map(sites.map((s) => [s.id, s.name]));
    await shareSettlementXlsx(worker, settlement, range, siteNames);
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
            <span className={cn("font-semibold", r.neg && "text-red")}>
              {formatPaise(r.v)}
            </span>
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
