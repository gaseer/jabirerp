# Supabase migrations

- `0013_document_lump_sum.sql` adds nullable `documents.lump_sum_paise` for **One Rate for all**. Run it in the SQL editor before deploying/syncing the updated app. Existing documents keep their item prices; no data backfill is needed. The app upgrades its local IndexedDB automatically.

- One file per slice, numbered `000N_name.sql`, applied in order.
- Workflow: open the Supabase dashboard → SQL editor → paste the file → run.
  Apply a slice's migration **before** testing sync for that slice.
- Every file is idempotent (`if not exists` / `drop policy if exists` guards),
  so re-running against the live project is safe.
- `0001_baseline.sql` reconstructs the schema that Slices 0–2 applied ad hoc;
  re-running it is a no-op.
