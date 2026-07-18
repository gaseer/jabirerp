import { create } from "zustand";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
  init: () => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ needsConfirmation: boolean }>;
  signIn: (email: string, password: string) => Promise<void>;
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
    set({ session, user, loading: false });

    if (!listenerRegistered) {
      listenerRegistered = true;
      supabase.auth.onAuthStateChange((event, s) => {
        if (event === "SIGNED_OUT") {
          cacheUser(null);
          set({ session: null, user: null });
          return;
        }
        // A failed offline refresh emits a null session — ignore it, the user
        // is still "signed in" locally until they explicitly sign out.
        if (!s && offline()) return;
        if (s?.user) cacheUser(s.user);
        set({ session: s, user: s?.user ?? (offline() ? cachedUser() : null) });
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

/** Owner id for Repo writes. Empty string when logged out (writes shouldn't happen then). */
export const currentOwnerId = () => useAuth.getState().user?.id ?? "";
