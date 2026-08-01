-- =============================================================================
-- 0010_worker_access.sql — worker self-service login (RBAC).
--
-- WHY: field workers can now sign in with just name + phone (no PIN — the
-- credential is deterministic, derived client-side from the phone number;
-- see src/lib/workerAuth.ts) and mark their own attendance, which lands as
-- 'pending' until the contractor approves it. Workers must see NOTHING
-- beyond their own attendance/payments/settlement and the bare NAME of
-- sites (never the sites table itself, never any other business data).
-- Enforced here via RLS, not just hidden in the UI: no policy is added for
-- sites/documents/line_items/shops/site_tasks/profiles for a worker
-- identity, so those tables are unreadable to a worker session even via a
-- direct API call.
--
-- Safe to run repeatedly.
-- =============================================================================

alter table public.employees add column if not exists auth_user_id uuid unique;

alter table public.attendance add column if not exists status text not null default 'approved';
alter table public.attendance drop constraint if exists attendance_status_check;
alter table public.attendance
  add constraint attendance_status_check check (status in ('pending', 'approved', 'rejected'));

-- ---------------------------------------------------------------------------
-- Auto-confirm only synthetic worker emails (w-<phone digits>@workers.
-- powerplus.local) so a worker's signUp can sign in immediately, with zero
-- effect on the owner's real-email confirmation flow.
-- ---------------------------------------------------------------------------
create or replace function public.autoconfirm_worker_email()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.email like '%@workers.powerplus.local' then
    new.email_confirmed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists on_worker_email on auth.users;
create trigger on_worker_email
  before insert on auth.users
  for each row execute function public.autoconfirm_worker_email();

-- ---------------------------------------------------------------------------
-- One-time claim: links the CALLING auth identity (auth.uid(), never a
-- client-supplied id) to the matching unclaimed employees row. Idempotent
-- for the same auth.uid() (safe to retry); rejects claiming a row already
-- linked to someone else.
-- ---------------------------------------------------------------------------
create or replace function public.claim_employee(p_name text, p_phone text)
returns table(employee_id uuid, owner_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
begin
  select e.id, e.owner_id, e.auth_user_id
    into v_row
  from public.employees e
  where e.deleted_at is null
    and lower(trim(e.name)) = lower(trim(p_name))
    and right(regexp_replace(coalesce(e.phone, ''), '\D', '', 'g'), 10)
      = right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10)
  limit 1;

  if v_row.id is null then
    raise exception 'no_matching_worker';
  elsif v_row.auth_user_id is not null and v_row.auth_user_id <> auth.uid() then
    raise exception 'already_claimed';
  end if;

  update public.employees set auth_user_id = auth.uid() where id = v_row.id;

  return query select v_row.id, v_row.owner_id;
end;
$$;

grant execute on function public.claim_employee(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Name-only site picker for marking attendance. Never exposes the sites
-- table (location/phone/status/etc) to a worker — only id + name, scoped to
-- the worker's own employer.
-- ---------------------------------------------------------------------------
create or replace function public.worker_site_names()
returns table(id uuid, name text)
language sql
security definer
set search_path = public, pg_temp
as $$
  select s.id, s.name
  from public.sites s
  join public.employees e on e.owner_id = s.owner_id
  where e.auth_user_id = auth.uid()
    and s.deleted_at is null
  order by s.name;
$$;

grant execute on function public.worker_site_names() to authenticated;

-- ---------------------------------------------------------------------------
-- Worker read/write access — additional PERMISSIVE policies, OR'd with the
-- existing *_owner policies (unchanged). A worker never gets UPDATE/DELETE
-- on attendance: they can't self-approve or edit hours after submitting.
-- ---------------------------------------------------------------------------
drop policy if exists "employees_worker_self" on public.employees;
create policy "employees_worker_self" on public.employees
  for select using (auth_user_id = auth.uid());

drop policy if exists "attendance_worker_select" on public.attendance;
create policy "attendance_worker_select" on public.attendance
  for select using (
    employee_id in (select id from public.employees where auth_user_id = auth.uid())
  );

drop policy if exists "attendance_worker_insert" on public.attendance;
create policy "attendance_worker_insert" on public.attendance
  for insert with check (
    status = 'pending'
    and owner_id = (
      select owner_id from public.employees
      where id = employee_id and auth_user_id = auth.uid()
    )
  );

drop policy if exists "transactions_worker_select" on public.transactions;
create policy "transactions_worker_select" on public.transactions
  for select using (
    txn_type = 'worker_payment'
    and employee_id in (select id from public.employees where auth_user_id = auth.uid())
  );
