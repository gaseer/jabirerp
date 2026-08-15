import { useState, type FormEvent } from "react";
import { useAuth } from "@/store/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { BrandMark } from "@/components/BrandMark";

/**
 * Worker sign-in at its own URL (/worker): name + phone only, no PIN. One
 * button handles both first-time activation (must match a worker the
 * contractor already added) and every login after — see signInOrClaimWorker in
 * the auth store. Once signed in, the session persists like the owner's until
 * an explicit Logout.
 */
export function WorkerLogin() {
  const signInOrClaimWorker = useAuth((s) => s.signInOrClaimWorker);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signInOrClaimWorker(name, phone);
      // No explicit navigation — App.tsx swaps in the worker app once the
      // store's user updates via onAuthStateChange.
    } catch (err) {
      if (!navigator.onLine) {
        setError("No internet connection. Connect and try again.");
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 p-6">
      <Card className="w-full max-w-sm">
        <div className="mb-4 flex flex-col items-center text-center">
          <BrandMark lockup />
        </div>
        {/* Names the screen loudly, so a worker knows at a glance they are on
            the right one and not the contractor's. */}
        <div className="mb-4 rounded-sm bg-primary-soft px-3 py-2 text-center">
          <p className="text-base font-bold text-primary">Worker sign-in</p>
          <p className="text-xs text-primary opacity-80">Enter your name and phone</p>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <Input
            placeholder="Full name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            required
          />
          <Input
            type="tel"
            placeholder="Phone number"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
          {error && <p className="text-sm text-red">{error}</p>}
          <Button type="submit" size="block" disabled={busy}>
            {busy ? "Please wait…" : "Continue"}
          </Button>
        </form>
        <p className="mt-4 text-center text-xs text-muted">
          First time here? Your contractor must add you as a worker first — use the
          exact name and phone they have on file.
        </p>
      </Card>
    </div>
  );
}
