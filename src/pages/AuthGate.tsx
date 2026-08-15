import { BrowserRouter, Route, Routes } from "react-router-dom";
import { WORKER_LOGIN_PATH } from "@/lib/routes";
import { Login } from "@/pages/Login";
import { WorkerLogin } from "@/pages/worker/WorkerLogin";

/**
 * Pre-auth entry point. The two sign-ins live at their own URLs rather than
 * behind a toggle, so a worker can be handed a link (or bookmark / install the
 * PWA) that always opens the worker screen instead of the contractor's.
 *
 * This needs its own BrowserRouter because the signed-in contractor router in
 * App.tsx only mounts after auth. Both never mount at once.
 *
 * Anything not /worker is the contractor login — a signed-in deep link like
 * /sites/x therefore shows the contractor sign-in, and App.tsx's router picks
 * the path back up once the session exists.
 */
export function AuthGate() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path={WORKER_LOGIN_PATH} element={<WorkerLogin />} />
        <Route path="*" element={<Login />} />
      </Routes>
    </BrowserRouter>
  );
}
