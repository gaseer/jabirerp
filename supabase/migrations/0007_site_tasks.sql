-- =============================================================================
-- 0007_site_tasks.sql — Slice 11. Per-site pending-works checklist.
-- Not a financial row: toggling done / editing text updates in place (LWW).
-- =============================================================================

create table if not exists public.site_tasks (
  id uuid primary key,
  owner_id uuid not null default auth.uid(),
  site_id uuid not null references public.sites (id) on delete restrict,
  text text not null,
  done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.site_tasks enable row level security;

drop policy if exists "site_tasks_owner" on public.site_tasks;
create policy "site_tasks_owner" on public.site_tasks
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop trigger if exists site_tasks_set_updated_at on public.site_tasks;
create trigger site_tasks_set_updated_at
  before insert or update on public.site_tasks
  for each row execute function public.set_updated_at();

create index if not exists site_tasks_owner_updated_idx
  on public.site_tasks (owner_id, updated_at);
create index if not exists site_tasks_site_idx on public.site_tasks (site_id);
