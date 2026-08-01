import { useState } from "react";
import { Login } from "@/pages/Login";
import { WorkerLogin } from "@/pages/worker/WorkerLogin";

/**
 * Pre-auth entry point: a small toggle between the contractor's existing
 * email/password login and the worker's name+phone login. Login.tsx itself
 * is untouched — this just decides which one to show.
 */
export function AuthGate() {
  const [asWorker, setAsWorker] = useState(false);

  return (
    <div className="relative min-h-full">
      {/* Login/WorkerLogin each own a full min-h-full centered layout already
          — this just floats the toggle near the bottom of that same page. */}
      {asWorker ? <WorkerLogin /> : <Login />}
      <button
        className="absolute inset-x-0 bottom-6 text-center text-sm text-primary hover:underline"
        onClick={() => setAsWorker((v) => !v)}
      >
        {asWorker ? "I'm the contractor — sign in instead" : "I'm a worker — sign in instead"}
      </button>
    </div>
  );
}
