-- =============================================================================
-- 0005_employees_attendance.sql — Slice 5. Workers + attendance.
-- Wages are HOURLY. An attendance row is a from/to shift ("HH:MM" 24h text,
-- zero-padded so lexical compare works and values round-trip sync unchanged).
-- attendance.wage_paise is the fully computed per-entry amount, rounded ONCE
-- at write time from the employee's hourly wage — later wage edits never
-- rewrite history, and sums stay exact integer additions.
-- Also attaches the employee FK to transactions (safe: no worker_payment rows
-- can exist before this slice — the shape CHECK rejects them).
--
-- REVISED 2026-07-12 (before first apply): daily wage + full/half/custom unit
-- model replaced by hourly wage + start/end times. If you applied the earlier
-- version, drop the employees and attendance tables and re-run this file.
-- =============================================================================

create table if not exists public.employees (
  id uuid primary key,
  owner_id uuid not null default auth.uid(),
  name text not null,
  phone text,
  role text not null check (role in ('Electrician', 'Plumber', 'Helper')),
  hourly_wage_paise bigint not null check (hourly_wage_paise >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.employees enable row level security;

drop policy if exists "employees_owner" on public.employees;
create policy "employees_owner" on public.employees
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop trigger if exists employees_set_updated_at on public.employees;
create trigger employees_set_updated_at
  before insert or update on public.employees
  for each row execute function public.set_updated_at();

create index if not exists employees_owner_updated_idx
  on public.employees (owner_id, updated_at);

-- ---------------------------------------------------------------------------
-- attendance — no uniqueness on (employee_id, work_date): two shifts at two
-- sites in one day is legitimate. The UI surfaces existing entries instead.
-- hours is stored (derived from the times at write) so sums never re-derive.
-- ---------------------------------------------------------------------------
create table if not exists public.attendance (
  id uuid primary key,
  owner_id uuid not null default auth.uid(),
  employee_id uuid not null references public.employees (id) on delete restrict,
  site_id uuid not null references public.sites (id) on delete restrict,
  work_date date not null,
  start_time text not null check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  end_time text not null check (end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  hours numeric not null check (hours > 0),
  wage_paise bigint not null check (wage_paise >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  -- Zero-padded HH:MM makes lexical order = time order. No overnight shifts.
  constraint attendance_time_order check (end_time > start_time)
);

alter table public.attendance enable row level security;

drop policy if exists "attendance_owner" on public.attendance;
create policy "attendance_owner" on public.attendance
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop trigger if exists attendance_set_updated_at on public.attendance;
create trigger attendance_set_updated_at
  before insert or update on public.attendance
  for each row execute function public.set_updated_at();

create index if not exists attendance_owner_updated_idx
  on public.attendance (owner_id, updated_at);
create index if not exists attendance_employee_idx on public.attendance (employee_id);
create index if not exists attendance_site_idx on public.attendance (site_id);
create index if not exists attendance_owner_date_idx
  on public.attendance (owner_id, work_date);

-- Attach the worker_payment FK now that employees exists.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'transactions_employee_fk'
  ) then
    alter table public.transactions
      add constraint transactions_employee_fk
      foreign key (employee_id) references public.employees (id) on delete restrict;
  end if;
end;
$$;
