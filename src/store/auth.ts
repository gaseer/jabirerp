import { create } from "zustand";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { resetLocalDataIfIdentityChanged } from "@/lib/db";
import { workerCredential } from "@/lib/workerAuth";

interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
  init: () => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ needsConfirmation: boolean }>;
  signIn: (email: string, password: string) => Promise<void>;
  signInOrClaimWorker: (name: string, phone: string) => Promise<void>;
  signOut: () => Promise<void>;
}

/**
 * OFFLINE-FIRST AUTH: Supabase can't refresh an expired token without the
 * network, and getSession() then reports no session — which used to bounce the
 * user to the Login screen and hide all their local data. We cache the last
 * signed-in user in localStorage and fall back to it while offline, so the app
 * (and every Dexie read/write, which needs user.id as owner_id) keeps working.
 * The cache is cleared only by an explicit sign-out.
 */
const LAST_USER_KEY = "powerplus-last-user";

function cacheUser(user: User | null): void {
  try {
    if (user) localStorage.setItem(LAST_USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(LAST_USER_KEY);
  } catch {
    // storage unavailable (private mode) — offline fallback simply won't apply
  }
}

function cachedUser(): User | null {
  try {
    const raw = localStorage.getItem(LAST_USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

const offline = () => typeof navigator !== "undefined" && !navigator.onLine;

/**
 * claim_employee raises bare sentinel strings (`raise exception 'x'`), which
 * arrive inside a generic Postgres error message. Turn each into something a
 * worker standing on a site can act on.
 */
function claimErrorMessage(raw: string | undefined): string {
  if (raw && /ambiguous_worker/.test(raw)) {
    return "Two workers are saved with this same name and phone. Ask your contractor to correct one of them.";
  }
  if (raw && /already_claimed/.test(raw)) {
    return "This worker is already signed in on another login. Ask your contractor to tap “Reset login” on your worker card, then try again.";
  }
  return "No matching worker found. Ask your contractor to check your name and phone, or add you as a worker first.";
}

/** onAuthStateChange must be registered once (StrictMode re-runs init in dev). */
let listenerRegistered = false;

export const useAuth = create<AuthState>((set) => ({
  session: null,
  user: null,
  loading: true,

  init: async () => {
    let session: Session | null = null;
    try {
      session = (await supabase.auth.getSession()).data.session;
    } catch {
      // network error during token refresh — treat as "no session" and fall back
    }
    if (session?.user) cacheUser(session.user);
    // No session + offline: keep the last known user so local data stays visible.
    const user = session?.user ?? (offline() ? cachedUser() : null);
    // Two identities (owner + worker, or an account switch) must never share
    // one browser's IndexedDB — DexieRepo.getAll() doesn't scope by identity,
    // it trusts exactly one signed-in identity per device. Wipe local data
    // BEFORE the store update fires any queries if the identity changed.
    if (user) await resetLocalDataIfIdentityChanged(user.id);
    set({ session, user, loading: false });

    if (!listenerRegistered) {
      listenerRegistered = true;
      supabase.auth.onAuthStateChange(async (event, s) => {
        if (event === "SIGNED_OUT") {
          cacheUser(null);
          set({ session: null, user: null });
          return;
        }
        // A failed offline refresh emits a null session — ignore it, the user
        // is still "signed in" locally until they explicitly sign out.
        if (!s && offline()) return;
        if (s?.user) cacheUser(s.user);
        const nextUser = s?.user ?? (offline() ? cachedUser() : null);
        if (nextUser) await resetLocalDataIfIdentityChanged(nextUser.id);
        set({ session: s, user: nextUser });
      });
    }
  },

  signUp: async (email, password) => {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      // Confirmation link returns to whatever origin the user signed up from
      // (localhost in dev, the deployed URL in prod). The origin must be in
      // Supabase Auth → URL Configuration → Redirect URLs.
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) throw error;
    // Existing user re-signing up: Supabase returns a user with empty identities.
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      throw new Error("An account with this email already exists. Sign in instead.");
    }
    // No session => email confirmation is required before sign in.
    return { needsConfirmation: !data.session };
  },

  signIn: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      // "Invalid login credentials" also fires for a correct password on an
      // unconfirmed account. Give a clearer hint instead of the raw message.
      if (/invalid login credentials/i.test(error.message)) {
        throw new Error(
          "Invalid email or password. If you just signed up, confirm your email first.",
        );
      }
      throw error;
    }
  },

  /**
   * One flow for both first-time activation and every login after: the
   * credential is derived deterministically from the phone number alone (see
   * workerCredential), so "sign in" and "sign up" are indistinguishable from
   * the worker's point of view — they always just type name + phone.
   */
  signInOrClaimWorker: async (name, phone) => {
    const trimmedName = name.trim();
    if (!trimmedName || !phone.trim()) throw new Error("Enter your name and phone number");
    // Credential covers name AND phone — see workerAuth.ts. A phone-only
    // credential merged every worker sharing a handset into one account.
    const { email, password } = workerCredential(trimmedName, phone);

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      if (!/invalid login credentials/i.test(signInError.message)) throw signInError;
      const { error: signUpError } = await supabase.auth.signUp({ email, password });
      if (signUpError) throw signUpError;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user;
    if (!user) {
      throw new Error(
        !navigator.onLine
          ? "No internet connection. Connect and try again."
          : "Could not sign in. Try again.",
      );
    }

    // Resolve the employee row on EVERY sign-in, not just the first. Two
    // reasons, both bugs in the previous "skip if metadata.employee_id is set"
    // version: (1) the RPC is the ONLY place name+phone is checked against the
    // contractor's list, so skipping it meant the name was never validated
    // after activation; (2) employee_id is a cached pointer — if the
    // contractor deleted and re-added the worker, it pointed at a row that no
    // longer exists and the worker app sat on "Loading…" forever with no way
    // out. Re-resolving fixes it on the next sign-in.
    const { data, error } = await supabase.rpc("claim_employee", {
      p_name: trimmedName,
      p_phone: phone,
    });
    const claim = data?.[0] as { employee_id: string; owner_id: string } | undefined;
    if (error || !claim) {
      // Failed validation must not leave a usable session behind.
      await supabase.auth.signOut();
      cacheUser(null);
      set({ session: null, user: null });
      throw new Error(claimErrorMessage(error?.message));
    }

    const metadata = (user.user_metadata ?? {}) as {
      employee_id?: string;
      owner_id?: string;
      display_name?: string;
      role?: string;
    };
    // Only write metadata when something actually changed — updateUser is a
    // network round trip and fires USER_UPDATED on every listener.
    if (
      metadata.role !== "worker" ||
      metadata.employee_id !== claim.employee_id ||
      metadata.owner_id !== claim.owner_id ||
      metadata.display_name !== trimmedName
    ) {
      const { error: updateError } = await supabase.auth.updateUser({
        data: {
          role: "worker",
          employee_id: claim.employee_id,
          owner_id: claim.owner_id,
          display_name: trimmedName,
        },
      });
      if (updateError) throw updateError;
    }
  },

  signOut: async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      // offline sign-out: the server call fails but we still log out locally
    }
    cacheUser(null);
    set({ session: null, user: null });
  },
}));

/**
 * Owner id for Repo writes. Empty string when logged out (writes shouldn't
 * happen then). For a worker session this is the CONTRACTOR's id, not the
 * worker's own auth uid — every row a worker writes (their attendance) must
 * be stamped with the tenant it belongs to, matching what the
 * attendance_worker_insert RLS policy checks. This is the single choke point
 * threaded into every DexieRepo and into SupabaseSync.push()'s cross-account
 * guard, so branching it here is enough to make both role-aware.
 */
export const currentOwnerId = () => {
  const user = useAuth.getState().user;
  if (!user) return "";
  const metadata = (user.user_metadata ?? {}) as { role?: string; owner_id?: string };
  return metadata.role === "worker" && metadata.owner_id ? metadata.owner_id : user.id;
};

/** True when the signed-in identity is a worker (vs the owner/contractor). */
export const isWorkerSession = () => {
  const user = useAuth.getState().user;
  return ((user?.user_metadata ?? {}) as { role?: string }).role === "worker";
};
