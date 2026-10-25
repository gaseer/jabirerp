# Production observability strategy — Power Plus

## Context

App going to production. Zero observability today: no error tracking, no crash reporting, no structured logging. Confirmed by exploration:

- **Pure web PWA** — no Capacitor/Electron/native wrapper (`vite-plugin-pwa` only). **Firebase Crashlytics doesn't apply** — it's a native-mobile SDK. Web equivalent needed instead.
- `SupabaseSync.ts` swallows all sync errors into `console.warn` (lines 84, 96, 136) — never surfaced to UI. On an offline-first app this is the highest-risk blind spot: a user could go weeks thinking data is syncing when it isn't.
- No error boundary, no `window.onerror`/`unhandledrejection` handler anywhere in `src/`.
- `registerSW()` in `main.tsx` has no `onRegisterError`/`onNeedRefresh` callbacks wired — SW failures and update availability are invisible.
- Deploy is Netlify, auto-build on push to `main`. No release tagging, no source maps shipped anywhere.
- Scale: solo contractor + small worker set — few users, not consumer scale. Full analytics ("monitor every user") is overkill and a privacy liability given this handles customer financial data; scoped error/crash visibility is the actual need.

Decision: **Sentry** for error tracking (free tier covers this scale; best React + source-map + offline-queuing support). This doc is **strategy only** — no code changes made. Implementation would follow CLAUDE.md's vertical-slice convention (one slice, one review gate) when built.

## What to instrument, and why

### 1. Error tracking — Sentry (`@sentry/react`)
- Init in `main.tsx`, DSN from new env var (`VITE_SENTRY_DSN`), gated so dev builds don't pollute the prod project (`environment: import.meta.env.MODE`, or skip init entirely in DEV).
- `beforeSend` scrubbing is mandatory before shipping: strip request bodies, URL query params, and breadcrumb data that could carry customer names/phone numbers/paise amounts. This is a financial-data app — treat Sentry payloads like any other place customer data could leak.

### 2. React error boundary
- Wrap app root with an `ErrorBoundary` (Sentry's `ErrorBoundary` component or a hand-rolled one calling `Sentry.captureException`). Fallback UI: simple "something broke, reload" screen — offline-first means a full crash shouldn't destroy local Dexie data, just the current render.

### 3. Global handlers
- `window.onerror` + `window.addEventListener("unhandledrejection", ...)` in `main.tsx`, both routed to Sentry. Catches non-React failures (Dexie transaction errors, PDF generation failures, etc.) that a React error boundary won't see.

### 4. Sync engine visibility (highest priority — fixes the silent-failure gap)
- `SupabaseSync.ts`'s existing `console.warn` calls (push/pull/dropped-row) should also `Sentry.captureException`/`addBreadcrumb` with context (table name, op, row id).
- Separately, surface sync health in the UI itself — not just to Sentry. The existing `powerplus:synced` `CustomEvent` (lines 157-167) only carries `{pushed, pulled}`; extend it (or add a sibling event) to carry error state, and show a small persistent banner/indicator when sync has been failing, so the user (not just a dashboard) knows data isn't reaching Supabase. This matters more than any third-party tool — it's the one failure mode that silently corrupts the offline-first guarantee.

### 5. Structured logging wrapper
- Thin `src/lib/logger.ts` replacing raw `console.warn` calls (currently 4 call sites total, all in `SupabaseSync.ts` + `supabase.ts:8`) with leveled calls that also drop a Sentry breadcrumb. Low effort given how few call sites exist today — worth doing now before the count grows.

### 6. Service worker observability
- Wire `onRegisterError` (capture to Sentry — SW registration failures are otherwise invisible) and `onNeedRefresh`/`onOfflineReady` (surface an "update available" toast) on the existing `registerSW()` call in `main.tsx:9`.

### 7. Release tracking
- Tag Sentry releases with the git commit SHA at build time (Netlify exposes `COMMIT_REF`) so every captured error maps to a deploy. Upload source maps as a Netlify build step (`sentry-cli` or `@sentry/vite-plugin`) — without this, minified prod stack traces are useless.

### 8. Alerting
- Sentry email alert on new/regressed issue types. Solo contractor won't watch a dashboard — push notification model fits better than a manual-check model.

### 9. Explicitly out of scope
- No full user-analytics/telemetry (PostHog, GA, Firebase Analytics) — wrong shape for a few-user financial tool, adds privacy surface for no operational benefit.
- No Firebase Crashlytics — native-only, doesn't apply to this PWA.
- Backend visibility (Postgres/auth logs) is already available via the Supabase dashboard — no separate tooling needed there.

## Suggested build order (if/when implemented)

Matches CLAUDE.md's slice convention — each stops for review:
1. Sentry init + error boundary + global handlers + env var + `beforeSend` scrubbing.
2. Sync-error → Sentry wiring + logger wrapper + UI sync-health banner (the highest-value slice).
3. Service worker error/update handling.
4. Release tagging + source map upload in Netlify build.

## Verification (once built)

- Throw a test error in a dev component → confirm it lands in Sentry with correct env tag and no scrubbed PII missing/leaking.
- Force a Supabase push failure (bad network) → confirm breadcrumb/error appears in Sentry AND the UI sync-health banner shows.
- Trigger the error boundary (throw in a render path) → confirm fallback UI renders, Dexie data untouched on reload.
- Deploy a build with a broken SW registration → confirm `onRegisterError` fires and is captured.
- Check a prod error's stack trace is de-minified (source maps uploaded correctly).
