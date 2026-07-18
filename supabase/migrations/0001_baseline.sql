-- =============================================================================
-- 0001_baseline.sql — reconstructed schema for Slices 0–2 (profiles, sites,
-- documents, line_items). ALREADY APPLIED to the live project via the SQL
-- editor; written idempotently so re-running against prod is a no-op.
-- Every later migration copies the RLS + updated_at trigger pattern below.
-- =============================================================================

-- Server-authoritative updated_at: makes the pull cursor reliable regardless
-- of client clocks. Fires on INSERT OR UPDATE.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles (Slice 0)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key,
  owner_id uuid not null default auth.uid(),
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_owner" on public.profiles;
create policy "profiles_owner" on public.profiles
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before insert or update on public.profiles
  for each row execute function public.set_updated_at();

create index if not exists profiles_owner_updated_idx
  on public.profiles (owner_id, updated_at);

-- ---------------------------------------------------------------------------
-- sites (Slice 1)
-- ---------------------------------------------------------------------------
create table if not exists public.sites (
  id uuid primary key,
  owner_id uuid not null default auth.uid(),
  name text not null,
  phone text,
  location text,
  work_type text not null check (work_type in ('Electrical', 'Plumbing', 'Mixed')),
  status text not null check (status in ('Active', 'Completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.sites enable row level security;

drop policy if exists "sites_owner" on public.sites;
create policy "sites_owner" on public.sites
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop trigger if exists sites_set_updated_at on public.sites;
create trigger sites_set_updated_at
  before insert or update on public.sites
  for each row execute function public.set_updated_at();

create index if not exists sites_owner_updated_idx
  on public.sites (owner_id, updated_at);

-- ---------------------------------------------------------------------------
-- documents (Slice 2) — quotation/bill headers; totals derived from line_items
-- ---------------------------------------------------------------------------
create table if not exists public.documents (
  id uuid primary key,
  owner_id uuid not null default auth.uid(),
  site_id uuid not null references public.sites (id) on delete restrict,
  kind text not null check (kind in ('quotation', 'bill')),
  doc_number text,
  status text not null check (status in ('draft', 'converted', 'final')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.documents enable row level security;

drop policy if exists "documents_owner" on public.documents;
create policy "documents_owner" on public.documents
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop trigger if exists documents_set_updated_at on public.documents;
create trigger documents_set_updated_at
  before insert or update on public.documents
  for each row execute function public.set_updated_at();

create index if not exists documents_owner_updated_idx
  on public.documents (owner_id, updated_at);
create index if not exists documents_site_idx on public.documents (site_id);

-- ---------------------------------------------------------------------------
-- line_items (Slice 2) — amount_paise = round(qty * rate_paise), integer paise
-- ---------------------------------------------------------------------------
create table if not exists public.line_items (
  id uuid primary key,
  owner_id uuid not null default auth.uid(),
  document_id uuid not null references public.documents (id) on delete restrict,
  description text not null,
  qty numeric not null,
  rate_paise bigint not null,
  amount_paise bigint not null,
  position integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.line_items enable row level security;

drop policy if exists "line_items_owner" on public.line_items;
create policy "line_items_owner" on public.line_items
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop trigger if exists line_items_set_updated_at on public.line_items;
create trigger line_items_set_updated_at
  before insert or update on public.line_items
  for each row execute function public.set_updated_at();

create index if not exists line_items_owner_updated_idx
  on public.line_items (owner_id, updated_at);
create index if not exists line_items_document_idx on public.line_items (document_id);
