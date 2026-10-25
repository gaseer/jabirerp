# Repository Guidelines

## Project Structure & Module Organization
Power Plus is an offline-first contractor ERP built with React, TypeScript, Vite, and Tailwind CSS. Screens live in `src/pages/`, reusable UI in `src/components/`, and business calculations in `src/domain/`. `src/repo/` contains Dexie repositories and Supabase synchronization; `src/lib/` holds database setup, money utilities, and document exports. Zustand stores and hooks live in `src/store/` and `src/hooks/`. Tests are colocated as `*.test.ts`, with shared setup in `src/test/setup.ts`. Assets belong in `src/assets/` or `public/`; SQL changes belong in `supabase/migrations/`.

## Build, Test, and Development Commands
- `npm ci`: install dependencies from the committed lockfile.
- `npm run dev`: start Vite on port 4599.
- `npm run build`: run TypeScript checks and produce the production bundle.
- `npm run preview`: serve the built app on port 4599.
- `npm test`: run all Vitest tests once.
- `npm run test:watch`: rerun tests during development.
- `npx vitest run src/domain/pnl.test.ts`: run a focused test file.

## Coding Style & Naming Conventions
Use strict TypeScript, two-space indentation, double quotes, and semicolons, matching surrounding code. Name React components in PascalCase and hooks with a `use` prefix. Prefer `@/` imports for shared source modules. No dedicated lint or formatter script is configured; keep formatting consistent and resolve compiler errors.

## Architecture & Data Rules
Read and write application data through repositories, preserving Dexie-first writes and outbox synchronization. Store money as integer paise; format only for display. Preserve soft deletion and historical financial records. New synchronized entities require a Dexie schema update, repository/type definitions, sync registry entry, and numbered SQL migration. Keep brand details in `src/lib/brand.ts`.

## Testing Guidelines
Vitest runs in Node with `fake-indexeddb`. Add colocated regression tests for domain calculations, persistence, and sync changes. No coverage threshold is configured. Run `npm test` and `npm run build` before submitting; update `VERIFICATION.md` when behavior changes.

## Commit & Pull Request Guidelines
History mixes short summaries with scoped messages such as `fix(worker-auth): ...` and `feat(invoice): ...`; prefer the scoped form. Describe the behavior change, validation performed, and related issues in PRs. Include screenshots for UI changes and migration instructions for schema changes.

## Configuration
Copy `.env.example` to `.env` and supply the Supabase URL and anonymous key. Never commit secrets. Production builds require these variables; `SKIP_ENV_CHECK=1` is reserved for compilation-only CI checks.
