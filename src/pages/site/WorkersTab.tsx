import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SiteRow } from "@/lib/db";
import { employeeRepo } from "@/repo/repos";
import { sync } from "@/repo/SupabaseSync";
import { listAttendance, markAttendance } from "@/domain/attendance";
import {
  attendanceWagePaise,
  hoursBetween,
  hoursLabel,
  isValidTime,
  timeRangeLabel,
} from "@/domain/wages";
import { formatPaise } from "@/lib/money";
import { formatDate, todayIso } from "@/lib/dates";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

const pushSoon = () => sync.sync().catch(() => {});

/**
 * Who worked on this site: per-worker hours + wages earned here, plus a
 * quick mark-attendance form (from/to shift times) preselecting this site.
 */
export function WorkersTab({ site }: { site: SiteRow }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    employeeId: "",
    date: todayIso(),
    start: "09:00",
    end: "17:00",
  });
  const [err, setErr] = useState<string | null>(null);

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
    mutationFn: () =>
      markAttendance({
        employeeId: form.employeeId,
        siteId: site.id,
        workDate: form.date,
        startTime: form.start,
        endTime: form.end,
      }),
    onSuccess: () => {
      pushSoon();
      setErr(null);
      qc.invalidateQueries({ queryKey: ["site-attendance", site.id] });
      qc.invalidateQueries({ queryKey: ["site-pnl", site.id] });
      // Wages changed → worker balances and duplicate hints are stale too.
      qc.invalidateQueries({ queryKey: ["employee-balances"] });
      qc.invalidateQueries({ queryKey: ["worker-day"] });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : "Could not save"),
  });

  // Per-worker rollup for this site.
  const byWorker = new Map<string, { hours: number; wagesPaise: number }>();
  for (const a of attendance) {
    const agg = byWorker.get(a.employee_id) ?? { hours: 0, wagesPaise: 0 };
    agg.hours += a.hours;
    agg.wagesPaise += a.wage_paise;
    byWorker.set(a.employee_id, agg);
  }
  const empName = new Map(employees.map((e) => [e.id, e.name]));
  const totalWages = attendance.reduce((s, a) => s + a.wage_paise, 0);

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

  return (
    <div className="space-y-3">
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
        ) : (
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
                <p className="text-sm text-muted">
                  {hoursLabel(previewHours)} × {formatPaise(selected.hourly_wage_paise)}
                  /hr ={" "}
                  <span className="font-semibold text-text">
                    {formatPaise(
                      attendanceWagePaise(selected.hourly_wage_paise, previewHours),
                    )}
                  </span>
                </p>
              )
            ) : (
              <p className="text-sm text-red">End time must be after start time.</p>
            )}
            {sameDay.length > 0 && (
              <p className="text-xs text-amber">
                Already marked on {formatDate(form.date)}:{" "}
                {sameDay
                  .map((r) => timeRangeLabel(r.start_time, r.end_time))
                  .join(", ")}
              </p>
            )}
            {err && <p className="text-sm text-red">{err}</p>}
            <Button type="submit" size="sm" disabled={mark.isPending || previewHours <= 0}>
              ✓ Mark attendance
            </Button>
          </form>
        )}
      </Card>

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
    </div>
  );
}
