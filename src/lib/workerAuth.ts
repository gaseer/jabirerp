/**
 * Deterministic worker credential, derived from the phone number ONLY (never
 * the name — a name has typo/casing/spacing variance across devices, a phone
 * number doesn't). This is not a real secret: the user explicitly chose
 * "name + phone, no PIN" as the login, so the derived password is just a
 * mechanical fit for Supabase's password field, reproducible on any device
 * from the same phone digits. `.local` is a non-routable synthetic domain —
 * Supabase never sends mail to it.
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

export function workerCredential(phone: string): { email: string; password: string } {
  const digits = normalizePhoneDigits(phone);
  return { email: `w-${digits}@workers.powerplus.local`, password: `wk-${digits}` };
}
