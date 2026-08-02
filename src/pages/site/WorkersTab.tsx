import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AttendanceRow, SiteRow } from "@/lib/db";
import { employeeRepo } from "@/repo/repos";
import { sync } from "@/repo/SupabaseSync";
import { editAttendance, listAttendance, markAttendance } from "@/domain/attendance";
import {
  attendanceWagePaise,
  hoursBetween,
  hoursLabel,
  isValidTime,
  timeRangeLabel,
} from "@/domain/wages";
import { formatPaise, paiseToRupees, toPaise } from "@/lib/money";
import { formatDate, todayIso } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { useEntryMode } from "@/store/settings";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { EntryGrid } from "@/components/grid/EntryGrid";
import { WageRoundEditor } from "@/components/WageRoundEditor";
import type { GridColumn, GridRow } from "@/components/grid/SheetGrid";

const pushSoon = () => sync.sync().catch(() => {});

/**
 * Who worked on this site: per-worker hours + wages earned here, plus a
 * quick mark-attendance form (from/to shift times) preselecting this site.
 */
const BLANK_SHIFT = { employeeId: "", date: todayIso(), start: "09:00", end: "17:00" };

export function WorkersTab({ site }: { site: SiteRow }) {
  const qc = useQueryClient();
  const excel = useEntryMode() === "excel";
  const [form, setForm] = useState(BLANK_SHIFT);
  // Non-null = the form is editing that existing entry instead of adding one.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Wage round-off override for the add/edit form; "" = use the computed wage.
  const [wageOverride, setWageOverride] = useState("");

  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => employeeRepo.getAll(),
  });

  const { data: attendance = [] } = useQuery({
    queryKey: ["site-attendance", site.id],
    queryFn: () => listAttendance({ siteId: site.id }),
  });

  // Duplicate guard (same as WorkerDetail): existing shifts for worker + date.
  const { data: sameDay = [] } = useQuery({
    queryKey: ["worker-day", form.employeeId, form.date],
    queryFn: () =>
      listAttendance({ employeeId: form.employeeId, from: form.date, to: form.date }),
    enabled: Boolean(form.employeeId),
  });

  const mark = useMutation({
    mutationFn: () => {
      const input = {
        employeeId: form.employeeId,
        siteId: site.id,
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
      qc.invalidateQueries({ queryKey: ["site-attendance", site.id] });
      qc.invalidateQueries({ queryKey: ["site-pnl", site.id] });
      // Wages changed → worker balances and duplicate hints are stale too.
      qc.invalidateQueries({ queryKey: ["employee-balances"] });
      qc.invalidateQueries({ queryKey: ["worker-day"] });
      qc.invalidateQueries({ queryKey: ["worker-attendance"] });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Could not save"),
  });

  function startEdit(row: AttendanceRow) {
    setEditingId(row.id);
    setErr(null);
    setForm({
      employeeId: row.employee_id,
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

  // Per-worker rollup for this site — pending/rejected shifts show in the
  // list below (with a status pill) but don't count as a wage cost yet.
  const approved = attendance.filter((a) => a.status === "approved");
  const byWorker = new Map<string, { hours: number; wagesPaise: number }>();
  for (const a of approved) {
    const agg = byWorker.get(a.employee_id) ?? { hours: 0, wagesPaise: 0 };
    agg.hours += a.hours;
    agg.wagesPaise += a.wage_paise;
    byWorker.set(a.employee_id, agg);
  }
  const empName = new Map(employees.map((e) => [e.id, e.name]));
  const totalWages = approved.reduce((s, a) => s + a.wage_paise, 0);

  // The entry being edited is not a duplicate of itself → never hint about it.
  const otherSameDay = sameDay.filter((r) => r.id !== editingId);

  // Live preview: hours + wage the entry will store.
  const selected = employees.find((w) => w.id === form.employeeId);
  const timesValid = isValidTime(form.start) && isValidTime(form.end);
  const previewHours = timesValid ? hoursBetween(form.start, form.end) : 0;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.employeeId) {
      setErr("Pick a worker");
      return;
    }
    mark.mutate();
  }

  const shiftForm = (
    <form onSubmit={submit} className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Select
          value={form.employeeId}
          onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
        >
          <option value="">Worker…</option>
          {employees.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
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
        selected && (
          <div className="space-y-1.5 rounded-sm bg-border/30 p-2">
            <p className="text-xs text-muted">
              {hoursLabel(previewHours)} × {formatPaise(selected.hourly_wage_paise)}/hr ={" "}
              {formatPaise(attendanceWagePaise(selected.hourly_wage_paise, previewHours))}
            </p>
            <WageRoundEditor
              computedPaise={attendanceWagePaise(selected.hourly_wage_paise, previewHours)}
              value={wageOverride}
              onChange={setWageOverride}
            />
          </div>
        )
      ) : (
        <p className="text-sm text-red">End time must be after start time.</p>
      )}
      {otherSameDay.length > 0 && (
        <p className="text-xs text-amber">
          Already marked on {formatDate(form.date)}:{" "}
          {otherSameDay
            .map((r) => timeRangeLabel(r.start_time, r.end_time))
            .join(", ")}
        </p>
      )}
      {err && <p className="text-sm text-red">{err}</p>}
      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={mark.isPending || previewHours <= 0}
        >
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

  // Excel mode: mark several shifts at once in a spreadsheet grid.
  const empWage = new Map(employees.map((e) => [e.id, e.hourly_wage_paise]));
  const rowWagePaise = (r: GridRow) => {
    const wage = empWage.get(r.worker);
    if (!wage || !isValidTime(r.start) || !isValidTime(r.end)) return 0;
    const h = hoursBetween(r.start, r.end);
    return h > 0 ? attendanceWagePaise(wage, h) : 0;
  };
  // Blank/unparsable override -> fall back to the computed wage for that row.
  const rowWageOverridePaise = (r: GridRow) => {
    const raw = (r.wage ?? "").trim();
    return raw ? toPaise(raw) : null;
  };
  const rowFinalWagePaise = (r: GridRow) => rowWageOverridePaise(r) ?? rowWagePaise(r);
  const attendanceColumns: GridColumn[] = [
    {
      key: "worker",
      label: "Worker",
      type: "select",
      placeholder: "Worker…",
      options: employees.map((e) => ({ value: e.id, label: e.name })),
    },
    { key: "date", label: "Date", type: "date" },
    { key: "start", label: "From", type: "time" },
    { key: "end", label: "To", type: "time" },
    { key: "wage", label: "Round ₹ (optional)", type: "rupee", align: "right" },
  ];
  const attendanceGrid = (
    <EntryGrid
      columns={attendanceColumns}
      blankRow={{ worker: "", date: todayIso(), start: "09:00", end: "17:00", wage: "" }}
      isRowBlank={(r) => !r.worker}
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
        // Validate every row up-front so a bad one doesn't half-save the batch.
        for (const r of rows) {
          if (!r.worker) throw new Error("Pick a worker in every row");
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
              employeeId: r.worker,
              siteId: site.id,
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
        qc.invalidateQueries({ queryKey: ["site-attendance", site.id] });
        qc.invalidateQueries({ queryKey: ["site-pnl", site.id] });
        qc.invalidateQueries({ queryKey: ["employee-balances"] });
        qc.invalidateQueries({ queryKey: ["worker-day"] });
        qc.invalidateQueries({ queryKey: ["worker-attendance"] });
      }}
    />
  );

  return (
    <div className="space-y-3">
      {/* Add form inline; editing a shift opens it in a modal over the tapped
          row instead of jumping up to the top of the page. */}
      {!editingId && (
        <Card className="space-y-3">
          <div className="font-semibold">Mark attendance at {site.name}</div>
          {employees.length === 0 ? (
            <p className="text-sm text-muted">
              No workers yet — add them on the{" "}
              <Link to="/workers" className="text-primary">
                Workers
              </Link>{" "}
              page first.
            </p>
          ) : excel ? (
            attendanceGrid
          ) : (
            shiftForm
          )}
        </Card>
      )}
      <Modal open={editingId !== null} onClose={cancelEdit} title="Edit attendance">
        {editingId && shiftForm}
      </Modal>

      <Card className="space-y-3">
        <div className="font-semibold">Workers on this site</div>
        {byWorker.size === 0 ? (
          <p className="text-sm text-muted">No attendance recorded yet.</p>
        ) : (
          <div className="divide-y divide-border">
            {[...byWorker.entries()].map(([empId, agg]) => (
              <Link
                key={empId}
                to={`/workers/${empId}`}
                className="flex items-center justify-between gap-2 py-2"
              >
                <div>
                  <div className="font-medium">{empName.get(empId) ?? "Unknown"}</div>
                  <div className="text-xs text-muted">{hoursLabel(agg.hours)} worked</div>
                </div>
                <div className="font-semibold">{formatPaise(agg.wagesPaise)}</div>
              </Link>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between border-t border-border pt-2 font-semibold">
          <span>Total wages (site)</span>
          <span className="text-red">{formatPaise(totalWages)}</span>
        </div>
      </Card>

      {attendance.length > 0 && (
        <Card className="space-y-3">
          <div className="font-semibold">Shifts at this site</div>
          <div className="divide-y divide-border">
            {attendance.map((r) => (
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
                      {empName.get(r.employee_id) ?? "Unknown"} · {hoursLabel(r.hours)}
                    </span>
                    {r.status !== "approved" && (
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold",
                          r.status === "pending"
                            ? "bg-amber-soft text-amber"
                            : "bg-red-soft text-red",
                        )}
                      >
                        {r.status === "pending" ? "Pending approval" : "Rejected"}
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted">
                    {formatDate(r.work_date)} ·{" "}
                    {timeRangeLabel(r.start_time, r.end_time)}
                  </div>
                </div>
                <div className="font-semibold">{formatPaise(r.wage_paise)}</div>
                <button
                  className="text-primary"
                  aria-label="Edit attendance"
                  onClick={() => startEdit(r)}
                >
                  ✏️
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
