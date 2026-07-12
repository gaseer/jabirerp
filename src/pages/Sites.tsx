import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { siteRepo } from "@/repo/repos";
import { sync } from "@/repo/SupabaseSync";
import type { SiteRow, SiteStatus, WorkType } from "@/lib/db";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

const WORK_TYPES: WorkType[] = ["Electrical", "Plumbing", "Mixed"];
const STATUSES: SiteStatus[] = ["Active", "Completed"];

type FormState = {
  id?: string;
  name: string;
  phone: string;
  location: string;
  work_type: WorkType;
  status: SiteStatus;
};

const empty: FormState = {
  name: "",
  phone: "",
  location: "",
  work_type: "Mixed",
  status: "Active",
};

export function Sites() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState | null>(null);

  const { data: sites = [] } = useQuery({
    queryKey: ["sites"],
    queryFn: () => siteRepo.getAll(),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["sites"] });

  const save = useMutation({
    mutationFn: async (f: FormState) => {
      await siteRepo.put({
        id: f.id,
        name: f.name.trim(),
        phone: f.phone.trim() || null,
        location: f.location.trim() || null,
        work_type: f.work_type,
        status: f.status,
      });
      // Fire-and-forget push; safe offline (no-op until reconnect).
      sync.sync().catch(() => {});
    },
    onSuccess: () => {
      setForm(null);
      refresh();
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await siteRepo.softDelete(id);
      sync.sync().catch(() => {});
    },
    onSuccess: refresh,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!form || !form.name.trim()) return;
    save.mutate(form);
  }

  function edit(s: SiteRow) {
    setForm({
      id: s.id,
      name: s.name,
      phone: s.phone ?? "",
      location: s.location ?? "",
      work_type: s.work_type,
      status: s.status,
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Sites</h2>
        <Button size="sm" onClick={() => setForm({ ...empty })}>
          ＋ Add site
        </Button>
      </div>

      {form && (
        <Card>
          <form onSubmit={submit} className="space-y-3">
            <div className="font-semibold">{form.id ? "Edit site" : "New site"}</div>
            <Input
              placeholder="Customer name *"
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
            <Input
              placeholder="Location"
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-3">
              <Select
                value={form.work_type}
                onChange={(e) =>
                  setForm({ ...form, work_type: e.target.value as WorkType })
                }
              >
                {WORK_TYPES.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </Select>
              <Select
                value={form.status}
                onChange={(e) =>
                  setForm({ ...form, status: e.target.value as SiteStatus })
                }
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </div>
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

      {sites.length === 0 && !form ? (
        <Card className="flex flex-col items-center gap-2 py-10 text-center text-muted">
          <span className="text-4xl">📍</span>
          <p>No sites yet. Tap ＋ to add your first job.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {sites.map((s) => (
            <Card key={s.id} className="flex items-center justify-between gap-3">
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() => navigate(`/sites/${s.id}`)}
              >
                <div className="truncate font-semibold">{s.name}</div>
                <div className="truncate text-sm text-muted">
                  {s.work_type}
                  {s.location ? ` · ${s.location}` : ""}
                  {s.phone ? ` · ${s.phone}` : ""}
                </div>
              </button>
              <span
                className={
                  s.status === "Active"
                    ? "rounded-full bg-green-soft px-2 py-0.5 text-xs font-semibold text-green"
                    : "rounded-full bg-border px-2 py-0.5 text-xs font-semibold text-muted"
                }
              >
                {s.status}
              </span>
              <button className="text-muted" aria-label="Edit site" onClick={() => edit(s)}>
                ✎
              </button>
              <button
                className="text-red"
                aria-label="Delete site"
                onClick={() => {
                  if (confirm(`Delete "${s.name}"?`)) remove.mutate(s.id);
                }}
              >
                🗑
              </button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
