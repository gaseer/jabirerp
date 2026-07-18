-- =============================================================================
-- 0006_shops.sql — Slice 9. Shops hold pass-through money (received from the
-- customer, owed onward to the shop). Shop txns live in transactions
-- (shop_in / shop_out); a shop txn's site is resolved via shops.site_id at
-- read time, never denormalized onto the txn.
-- Also attaches the shop FK to transactions (safe: no shop txns can exist
-- before this slice — the shape CHECK rejects them).
-- =============================================================================

create table if not exists public.shops (
  id uuid primary key,
  owner_id uuid not null default auth.uid(),
  name text not null,
  phone text,
  site_id uuid references public.sites (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.shops enable row level security;

drop policy if exists "shops_owner" on public.shops;
create policy "shops_owner" on public.shops
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop trigger if exists shops_set_updated_at on public.shops;
create trigger shops_set_updated_at
  before insert or update on public.shops
  for each row execute function public.set_updated_at();

create index if not exists shops_owner_updated_idx
  on public.shops (owner_id, updated_at);
create index if not exists shops_site_idx on public.shops (site_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'transactions_shop_fk'
  ) then
    alter table public.transactions
      add constraint transactions_shop_fk
      foreign key (shop_id) references public.shops (id) on delete restrict;
  end if;
end;
$$;
