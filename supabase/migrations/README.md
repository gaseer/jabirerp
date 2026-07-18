# Supabase migrations

- One file per slice, numbered `000N_name.sql`, applied in order.
- Workflow: open the Supabase dashboard → SQL editor → paste the file → run.
  Apply a slice's migration **before** testing sync for that slice.
- Every file is idempotent (`if not exists` / `drop policy if exists` guards),
  so re-running against the live project is safe.
- `0001_baseline.sql` reconstructs the schema that Slices 0–2 applied ad hoc;
  re-running it is a no-op.
