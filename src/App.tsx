import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "@/store/auth";
import { profileRepo } from "@/repo/repos";
import { AppShell } from "@/components/AppShell";
import { Login } from "@/pages/Login";
import { Dashboard } from "@/pages/Dashboard";
import { Sites } from "@/pages/Sites";
import { SiteDetail } from "@/pages/SiteDetail";
import { Placeholder } from "@/pages/Placeholder";

export default function App() {
  const { user, loading, init } = useAuth();

  useEffect(() => {
    init();
  }, [init]);

  // On login, mirror the auth user into the local profiles store via the Repo.
  // This exercises the full local-first write path (Dexie + outbox) end to end.
  useEffect(() => {
    if (!user) return;
    profileRepo.put({
      id: user.id,
      display_name:
        (user.user_metadata?.display_name as string | undefined) ?? null,
    });
  }, [user]);

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center text-muted">
        Loading…
      </div>
    );
  }

  if (!user) return <Login />;

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Dashboard />} />
          <Route path="sites" element={<Sites />} />
          <Route path="sites/:id" element={<SiteDetail />} />
          <Route path="workers" element={<Placeholder icon="👷" title="Workers" slice="Slice 6" />} />
          <Route path="ledger" element={<Placeholder icon="📒" title="Ledger" slice="Slice 3" />} />
          <Route path="shops" element={<Placeholder icon="🏪" title="Shops" slice="Slice 9" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
