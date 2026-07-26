import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "@/store/auth";
import { profileRepo } from "@/repo/repos";
import { AppShell } from "@/components/AppShell";
import { Login } from "@/pages/Login";
import { Dashboard } from "@/pages/Dashboard";
import { Sites } from "@/pages/Sites";
import { SiteDetail } from "@/pages/SiteDetail";
import { Workers } from "@/pages/Workers";
import { WorkerDetail } from "@/pages/WorkerDetail";
import { Ledger } from "@/pages/Ledger";
import { Shops } from "@/pages/Shops";
import { Reports } from "@/pages/Reports";
import { Settings } from "@/pages/Settings";

export default function App() {
  const { user, loading, init } = useAuth();

  useEffect(() => {
    init();
  }, [init]);

  // On login, mirror the auth user into the local profiles store via the Repo —
  // but only when it actually changed: an unconditional put would dirty and
  // enqueue a profile push on every app launch.
  useEffect(() => {
    if (!user) return;
    const display_name =
      (user.user_metadata?.display_name as string | undefined) ?? null;
    profileRepo.getById(user.id).then((existing) => {
      if (!existing || existing.display_name !== display_name) {
        profileRepo.put({ id: user.id, display_name });
      }
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
          <Route path="workers" element={<Workers />} />
          <Route path="workers/:id" element={<WorkerDetail />} />
          <Route path="ledger" element={<Ledger />} />
          <Route path="shops" element={<Shops />} />
          <Route path="reports" element={<Reports />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
