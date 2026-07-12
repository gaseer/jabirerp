import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { profileRepo } from "@/repo/repos";
import { sync } from "@/repo/SupabaseSync";
import { db } from "@/lib/db";
import { useAuth } from "@/store/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function Dashboard() {
  const user = useAuth((s) => s.user);
  const qc = useQueryClient();
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  // Proves the local round-trip: read the profile row back from Dexie via Repo.
  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => (user ? ((await profileRepo.getById(user.id)) ?? null) : null),
    enabled: !!user,
  });

  const { data: outboxCount } = useQuery({
    queryKey: ["outbox"],
    queryFn: () => db.outbox.count(),
    refetchInterval: 2000,
  });

  async function runSync() {
    const res = await sync.sync();
    setSyncMsg(`Sync (stub): pushed ${res.pushed}, pulled ${res.pulled}.`);
    qc.invalidateQueries({ queryKey: ["outbox"] });
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Home</h2>

      <Card className="space-y-1">
        <div className="text-sm text-muted">Signed in as</div>
        <div className="font-semibold">{user?.email}</div>
        <div className="text-xs text-muted">owner_id: {user?.id}</div>
      </Card>

      <Card className="space-y-2">
        <div className="font-semibold">Local store (Dexie) round-trip</div>
        {profile ? (
          <div className="text-sm text-green">
            ✓ Profile row read back locally — id {profile.id.slice(0, 8)}…, dirty:{" "}
            {profile._dirty}
          </div>
        ) : (
          <div className="text-sm text-muted">No local profile row yet.</div>
        )}
        <div className="text-sm text-muted">Outbox queued writes: {outboxCount ?? 0}</div>
        <Button size="sm" variant="soft" onClick={runSync}>
          Run sync (stub)
        </Button>
        {syncMsg && <div className="text-xs text-muted">{syncMsg}</div>}
      </Card>

      <Card className="text-sm text-muted">
        Walking skeleton (Slice 0). Real dashboard numbers arrive in Slice 10.
      </Card>
    </div>
  );
}
