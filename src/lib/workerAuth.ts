/**
 * Deterministic worker credential, derived from name AND phone.
 *
 * This is not a real secret: the user explicitly chose "name + phone, no PIN"
 * as the login, so the derived password is just a mechanical fit for
 * Supabase's password field, reproducible on any device from the same inputs.
 * `.local` is a non-routable synthetic domain — Supabase never sends mail to
 * it, and the autoconfirm_worker_email trigger keys off that domain.
 *
 * The phone ALONE is not an identity: several workers legitimately share one
 * handset, and names are what separate them. When the credential was derived
 * from the phone only, those workers collapsed into a single auth account —
 * whoever activated first owned it, and everyone else signing in with that
 * phone (under any name) landed inside that first worker's session. Both parts
 * are hashed in now, so each name+phone pair is its own identity.
 */

/**
 * Last 10 digits only — matches the claim_employee RPC's `right(..., 10)`
 * comparison, so "+91 98470 12345" and "98470 12345" resolve to the same
 * credential regardless of which format a worker (or the admin who first
 * typed the phone into Workers.tsx) happened to use.
 */
export function normalizePhoneDigits(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

/**
 * Case- and spacing-insensitive name key. Must stay in lockstep with the
 * norm_worker_name() SQL function the claim RPC matches on, or a worker could
 * derive a credential whose name the server then refuses to match.
 */
export function normalizeWorkerName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** FNV-1a, 32 bits. Operates on UTF-16 code units, so a Malayalam name hashes
 *  identically on every device. Not a security hash — just a stable, sync,
 *  dependency-free way to fold an arbitrary name into an email-safe token. */
function fnv1a(input: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 64 bits of name, as 16 hex chars — two independently seeded 32-bit passes.
 *  A collision here would re-create the very bug this replaces, so one 32-bit
 *  pass (birthday collision at ~65k names) is not enough headroom. */
function nameToken(name: string): string {
  const key = normalizeWorkerName(name);
  const a = fnv1a(key, 0x811c9dc5);
  const b = fnv1a(key, 0x811c9dc5 ^ 0x5bf03635);
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/**
 * The phone digits stay in the local part in the clear (readable in the
 * Supabase auth users list, which is how this gets debugged); the name rides
 * along as a hash because names carry spaces and non-ASCII.
 */
export function workerCredential(
  name: string,
  phone: string,
): { email: string; password: string } {
  const digits = normalizePhoneDigits(phone);
  const token = nameToken(name);
  return {
    email: `w-${digits}-${token}@workers.powerplus.local`,
    password: `wk-${digits}-${token}`,
  };
}
