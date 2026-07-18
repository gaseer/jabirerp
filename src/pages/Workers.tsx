import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { employeeRepo } from "@/repo/repos";
import { sync } from "@/repo/SupabaseSync";
import type { EmployeeRole, EmployeeRow } from "@/lib/db";
import { empBalancePaise } from "@/domain/settlement";
import { formatPaise, toPaise } from "@/lib/money";
import { matchesQuery } from "@/lib/search";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SearchInput } from "@/components/SearchInput";
import { cn } from "@/lib/utils";

const ROLES: EmployeeRole[] = ["Electrician", "Plumber", "Helper"];

type WorkerSort = "recent" | "name" | "balance" | "wage";
const SORT_LABELS: Record<WorkerSort, string> = {
  recent: "Recently updated",
  name: "Name A–Z",
  balance: "Balance high→low",
  wage: "Wage high→low",
};

type FormState = {
  id?: string;
  name: string;
  phone: string;
  role: EmployeeRole;
  wage: string; // rupees per HOUR, converted to paise on save
};

const empty: FormState = { name: "", phone: "", role: "Electrician", wage: "" };

export function Workers() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState | null>(null);

  const { data: workers = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => employeeRepo.getAll(),
  });

  // Balance payable per worker — derived, shown on each card.
  const { data: balances = {} } = useQuery({
    queryKey: ["employee-balances", workers.map((w) => w.id)],
    queryFn: async () => {
      const entries = await Promise.all(
        workers.map(async (w) => [w.id, await empBalancePaise(w.id)] as const),
      );
      return Object.fromEntries(entries) as Record<string, number>;
    },
    enabled: workers.length > 0,
  });

  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<"" | EmployeeRole>("");
  const [sort, setSort] = useState<WorkerSort>("recent");

  // getAll returns updated_at desc — "recent" keeps that order.
  const visible = workers
    .filter(
      (w) => (!roleFilter || w.role === roleFilter) && matchesQuery(q, w.name, w.phone),
    )
    .sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "balance") return (balances[b.id] ?? 0) - (balances[a.id] ?? 0);
      if (sort === "wage") return b.hourly_wage_paise - a.hourly_wage_paise;
      return 0;
    });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["employees"] });
    qc.invalidateQueries({ queryKey: ["employee-balances"] });
  };

  const save = useMutation({
    mutationFn: async (f: FormState) => {
      await employeeRepo.put({
        id: f.id,
        name: f.name.trim(),
        phone: f.phone.trim() || null,
        role: f.role,
        hourly_wage_paise: toPaise(f.wage),
      });
      sync.sync().catch(() => {});
    },
    onSuccess: () => {
      setForm(null);
      refresh();
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await employeeRepo.softDelete(id);
      sync.sync().catch(() => {});
    },
    onSuccess: refresh,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!form || !form.name.trim()) return;
    save.mutate(form);
  }

  function edit(w: EmployeeRow) {
    setForm({
      id: w.id,
      name: w.name,
      phone: w.phone ?? "",
      role: w.role,
      wage: String(w.hourly_wage_paise / 100),
    });
  }

  function confirmDelete(w: EmployeeRow) {
    const bal = balances[w.id] ?? 0;
    const warning =
      bal !== 0
        ? `${w.name} has a balance of ${formatPaise(bal)}. History is kept, but the worker disappears from lists. Delete anyway?`
        : `Delete "${w.name}"?`;
    if (confirm(warning)) remove.mutate(w.id);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Workers</h2>
        <Button size="sm" onClick={() => setForm({ ...empty })}>
          ＋ Add worker
        </Button>
      </div>

      {form && (
        <Card>
          <form onSubmit={submit} className="space-y-3">
            <div className="font-semibold">{form.id ? "Edit worker" : "New worker"}</div>
            <Input
              placeholder="Name *"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              autoFocus
              required
            />
            <Input
              placeholder="Phone"
              inputMode="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-3">
              <Select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as EmployeeRole })}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
              <Input
                placeholder="Hourly wage ₹ *"
                inputMode="decimal"
                value={form.wage}
                onChange={(e) => setForm({ ...form, wage: e.target.value })}
                required
              />
            </div>
            {form.id && (
              <p className="text-xs text-muted">
                Wage changes affect FUTURE attendance only — past days keep their
                recorded wage.
              </p>
            )}
            <div className="flex gap-2">
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setForm(null)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {workers.length === 0 && !form ? (
        <Card className="flex flex-col items-center gap-2 py-10 text-center text-muted">
          <span className="text-4xl">👷</span>
          <p>No workers yet. Tap ＋ to add your first worker.</p>
        </Card>
      ) : (
        <>
          <div className="space-y-2">
            <SearchInput value={q} onChange={setQ} placeholder="Search name, phone…" />
            <div className="grid grid-cols-2 gap-2">
              <Select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value as "" | EmployeeRole)}
                className="h-9 text-sm"
              >
                <option value="">All roles</option>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
              <Select
                value={sort}
                onChange={(e) => setSort(e.target.value as WorkerSort)}
                className="h-9 text-sm"
              >
                {Object.entries(SORT_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    ↕ {label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {visible.length === 0 ? (
            <Card className="py-6 text-center text-sm text-muted">
              No workers match the search/filter.
            </Card>
          ) : (
        <div className="space-y-2">
          {visible.map((w) => {
            const bal = balances[w.id] ?? 0;
            return (
              <Card key={w.id} className="flex items-center justify-between gap-3">
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => navigate(`/workers/${w.id}`)}
                >
                  <div className="truncate font-semibold">{w.name}</div>
                  <div className="truncate text-sm text-muted">
                    {w.role} · {formatPaise(w.hourly_wage_paise)}/hr
                    {w.phone ? ` · ${w.phone}` : ""}
                  </div>
                </button>
                <div className="text-right">
                  <div className={cn("font-semibold", bal > 0 ? "text-amber" : "text-green")}>
                    {formatPaise(Math.abs(bal))}
                  </div>
                  <div className="text-[11px] text-muted">
                    {bal > 0 ? "payable" : bal < 0 ? "advance given" : "settled"}
                  </div>
                </div>
                <button className="text-muted" aria-label="Edit worker" onClick={() => edit(w)}>
                  ✎
                </button>
                <button
                  className="text-red"
                  aria-label="Delete worker"
                  onClick={() => confirmDelete(w)}
                >
                  🗑
                </button>
              </Card>
            );
          })}
        </div>
          )}
        </>
      )}
    </div>
  );
}
