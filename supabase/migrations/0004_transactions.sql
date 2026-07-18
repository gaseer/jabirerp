-- =============================================================================
-- 0004_transactions.sql — Slice 4. One table for ALL money movements.
-- Direction (in/out) is derived from txn_type, never stored:
--   in  = customer_advance, shop_in
--   out = site_expense, worker_payment, shop_out
-- employee_id / shop_id are plain uuid columns here; their FK constraints are
-- added in 0005 / 0006 when the parent tables exist (safe: the per-type CHECK
-- below means no row can carry those ids until the creators for those types
-- ship in the same slices).
-- =============================================================================

create table if not exists public.transactions (
  id uuid primary key,
  owner_id uuid not null default auth.uid(),
  txn_type text not null,
  amount_paise bigint not null,
  mode text not null,
  txn_date date not null,
  site_id uuid references public.sites (id) on delete restrict,
  employee_id uuid,
  shop_id uuid,
  category text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint transactions_amount_positive check (amount_paise > 0),
  constraint transactions_mode_valid check (mode in ('cash', 'bank')),
  constraint transactions_type_valid check (
    txn_type in ('customer_advance', 'site_expense', 'worker_payment', 'shop_in', 'shop_out')
  ),
  -- Per-type column shape. worker_payment and shop txns carry NO site_id:
  -- wages attribute to sites via attendance; shop txns resolve their site
  -- through shops.site_id at read time.
  constraint transactions_shape_valid check (
    (txn_type = 'customer_advance' and site_id is not null and employee_id is null and shop_id is null and category is null)
    or (txn_type = 'site_expense' and site_id is not null and category is not null and employee_id is null and shop_id is null)
    or (txn_type = 'worker_payment' and employee_id is not null and site_id is null and shop_id is null and category is null)
    or (txn_type in ('shop_in', 'shop_out') and shop_id is not null and employee_id is null and site_id is null and category is null)
  )
);

alter table public.transactions enable row level security;

drop policy if exists "transactions_owner" on public.transactions;
create policy "transactions_owner" on public.transactions
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop trigger if exists transactions_set_updated_at on public.transactions;
create trigger transactions_set_updated_at
  before insert or update on public.transactions
  for each row execute function public.set_updated_at();

create index if not exists transactions_owner_updated_idx
  on public.transactions (owner_id, updated_at);
create index if not exists transactions_owner_date_idx
  on public.transactions (owner_id, txn_date);
create index if not exists transactions_site_idx on public.transactions (site_id);
create index if not exists transactions_employee_idx on public.transactions (employee_id);
create index if not exists transactions_shop_idx on public.transactions (shop_id);
