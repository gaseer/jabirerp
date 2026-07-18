import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SiteRow } from "@/lib/db";
import { db } from "@/lib/db";
import { siteTaskRepo } from "@/repo/repos";
import { sync } from "@/repo/SupabaseSync";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const pushSoon = () => sync.sync().catch(() => {});

/** Pending-works checklist. Non-financial, so toggle edits in place (LWW). */
export function PendingTab({ site }: { site: SiteRow }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");

  const key = ["site-tasks", site.id];
  const { data: tasks = [] } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const rows = await db.site_tasks.where("site_id").equals(site.id).toArray();
      return rows
        .filter((t) => t.deleted_at === null)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const add = useMutation({
    mutationFn: async () => {
      await siteTaskRepo.put({ site_id: site.id, text: text.trim(), done: false });
      pushSoon();
    },
    onSuccess: () => {
      setText("");
      refresh();
    },
  });

  const toggle = useMutation({
    mutationFn: async (id: string) => {
      const task = tasks.find((t) => t.id === id);
      if (!task) return;
      await siteTaskRepo.put({ id, site_id: task.site_id, text: task.text, done: !task.done });
      pushSoon();
    },
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await siteTaskRepo.softDelete(id);
      pushSoon();
    },
    onSuccess: refresh,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    add.mutate();
  }

  return (
    <Card className="space-y-3">
      <div className="font-semibold">Pending works</div>

      <form onSubmit={submit} className="flex gap-2">
        <Input
          placeholder="Add a pending work…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit" size="sm" className="h-11 shrink-0" disabled={add.isPending}>
          ＋ Add
        </Button>
      </form>

      {tasks.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted">No pending works 🎉</p>
      ) : (
        <div className="divide-y divide-border">
          {tasks.map((t) => (
            <div key={t.id} className="flex items-center gap-3 py-2">
              <button
                aria-label={t.done ? "Mark not done" : "Mark done"}
                onClick={() => toggle.mutate(t.id)}
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs",
                  t.done
                    ? "border-green bg-green-soft text-green"
                    : "border-border text-transparent",
                )}
              >
                ✓
              </button>
              <span
                className={cn(
                  "min-w-0 flex-1 text-sm",
                  t.done && "text-muted line-through",
                )}
              >
                {t.text}
              </span>
              <button
                className="text-red"
                aria-label="Delete task"
                onClick={() => remove.mutate(t.id)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
