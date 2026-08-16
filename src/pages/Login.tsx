import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/store/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { BrandMark } from "@/components/BrandMark";
import { Icon } from "@/components/Icon";
import { WORKER_LOGIN_PATH } from "@/lib/routes";

export function Login() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === "up") {
        const { needsConfirmation } = await signUp(email, password);
        if (needsConfirmation) {
          setInfo("Account created. Check your inbox to confirm your email, then sign in.");
          setMode("in");
        }
        // else: confirmation off => session set via onAuthStateChange, app routes in.
      } else {
        await signIn(email, password);
      }
    } catch (err) {
      // A fetch failure while offline is not the user's fault — say so plainly.
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
        <div className="mb-5 flex flex-col items-center text-center">
          <BrandMark lockup />
        </div>
        <p className="mb-4 text-sm text-muted">
          {mode === "in" ? "Sign in to your account" : "Create your account"}
        </p>
        <form onSubmit={submit} className="space-y-3">
          <Input
            type="email"
            placeholder="Email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            type="password"
            placeholder="Password"
            autoComplete={mode === "in" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
          {error && <p className="text-sm text-red">{error}</p>}
          {info && <p className="text-sm text-green">{info}</p>}
          <Button type="submit" size="block" disabled={busy}>
            {busy ? "Please wait…" : mode === "in" ? "Sign in" : "Sign up"}
          </Button>
        </form>
        <button
          className="mt-4 w-full text-center text-sm text-primary hover:underline"
          onClick={() => {
            setMode(mode === "in" ? "up" : "in");
            setError(null);
            setInfo(null);
          }}
        >
          {mode === "in" ? "Need an account? Sign up" : "Have an account? Sign in"}
        </button>
      </Card>

      {/* Deliberately loud: this is the contractor's screen, and a worker who
          lands here by default must be able to spot the way out at a glance —
          a small tinted text link was being missed. Its own card, brand blue,
          helmet mark, tap-target sized. */}
      <Link
        to={WORKER_LOGIN_PATH}
        className="group flex w-full max-w-sm items-center gap-3 rounded border-2 border-primary bg-primary-soft p-3 text-primary shadow-card transition hover:bg-primary hover:text-white"
      >
        <span
          aria-hidden
          className="grid h-11 w-11 shrink-0 place-items-center rounded-sm bg-primary text-white transition group-hover:bg-white group-hover:text-primary"
        >
          <Icon name="workers" className="h-6 w-6" />
        </span>
        <span className="min-w-0 leading-tight">
          <span className="block font-cond text-base font-bold uppercase tracking-[0.02em]">
            I'm a worker
          </span>
          <span className="block text-xs opacity-80">Sign in with your name and phone</span>
        </span>
        <span aria-hidden className="ml-auto pr-1 text-xl font-bold">
          &rsaquo;
        </span>
      </Link>
    </div>
  );
}
