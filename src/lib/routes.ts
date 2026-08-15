/**
 * Pre-auth URLs. Its own module so the two sign-in screens can cross-link
 * without importing AuthGate (which imports them) — a cycle.
 */

/**
 * Worker name+phone sign-in. Shareable — a worker can be sent straight here.
 * One-way on purpose: the contractor's screen links here, this one links back
 * nowhere, so a worker on /worker cannot wander into the owner sign-in.
 */
export const WORKER_LOGIN_PATH = "/worker";
