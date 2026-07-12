import { useState, type FormEvent } from "react";
import { useAuth } from "@/store/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

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
        await signUp(email, password);
        setInfo("Account created. If email confirmation is on, check your inbox, then sign in.");
        setMode("in");
      } else {
        await signIn(email, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <div className="mb-5 flex items-center gap-2">
          <span className="text-2xl">⚡</span>
          <h1 className="text-xl font-bold">Power Plus</h1>
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
    </div>
  );
}
