-- =============================================================================
-- 0012_worker_login_name_phone.sql — worker login identity = name + phone.
--
-- WHY: 0010 derived the worker credential from the PHONE ALONE. Several
-- workers legitimately share one handset, so they all collapsed onto a single
-- auth account: whoever activated first owned it, and everyone else who typed
-- that phone (under ANY name) was signed straight into the first worker's
-- session — their attendance, their payments, their settlement. The client now
-- derives the credential from name AND phone (src/lib/workerAuth.ts), so each
-- pair is its own identity.
--
-- This migration does three things:
--   1. norm_worker_name() — one canonical name key, shared by the RPC and the
--      client, so casing and stray spaces can never desync the two.
--   2. claim_employee() — refuses an AMBIGUOUS match instead of silently
--      taking the first of several; skips the write when nothing changed (the
--      client now calls it on every sign-in, not just the first).
--   3. Detaches every employee still bound to an OLD phone-only auth account,
--      so those workers re-activate under the new identity on next sign-in.
--
-- ⚠ Step 3 makes currently-signed-in workers lose access until they sign in
--   again (the app tells them to). Their history is untouched — only the
--   employees.auth_user_id link is cleared. The old auth users are left in
--   place, orphaned and harmless; nothing derives their credential any more.
--
-- Safe to run repeatedly: step 3 matches only the old email shape, which a
-- re-activated worker no longer has.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Canonical name key: trimmed, inner runs of whitespace collapsed to one
--    space, lowercased. Mirrors normalizeWorkerName() in src/lib/workerAuth.ts.
-- ---------------------------------------------------------------------------
create or replace function public.norm_worker_name(p_name text)
returns text
language sql
immutable
set search_path = pg_temp
as $$
  select lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'));
$$;

grant execute on function public.norm_worker_name(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Resolve + link. Called on EVERY worker sign-in now, which is what makes
--    the name a real credential rather than a one-time activation formality,
--    and what heals a stale employee_id after a worker is deleted and re-added.
-- ---------------------------------------------------------------------------
create or replace function public.claim_employee(p_name text, p_phone text)
returns table(employee_id uuid, owner_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_phone text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  v_matches int;
begin
  select count(*)
    into v_matches
  from public.employees e
  where e.deleted_at is null
    and public.norm_worker_name(e.name) = public.norm_worker_name(p_name)
    and right(regexp_replace(coalesce(e.phone, ''), '\D', '', 'g'), 10) = v_phone;

  -- Two live workers with the same name AND phone are indistinguishable to
  -- this login. Picking one at random would sign somebody into a stranger's
  -- record — fail loudly and let the contractor fix the duplicate.
  if v_matches > 1 then
    raise exception 'ambiguous_worker';
  end if;

  select e.id, e.owner_id, e.auth_user_id
    into v_row
  from public.employees e
  where e.deleted_at is null
    and public.norm_worker_name(e.name) = public.norm_worker_name(p_name)
    and right(regexp_replace(coalesce(e.phone, ''), '\D', '', 'g'), 10) = v_phone
  limit 1;

  if v_row.id is null then
    raise exception 'no_matching_worker';
  elsif v_row.auth_user_id is not null and v_row.auth_user_id <> auth.uid() then
    raise exception 'already_claimed';
  end if;

  -- Guarded so a routine sign-in doesn't bump updated_at and churn the pull
  -- cursor on every device.
  update public.employees
     set auth_user_id = auth.uid()
   where id = v_row.id
     and auth_user_id is distinct from auth.uid();

  return query select v_row.id, v_row.owner_id;
end;
$$;

grant execute on function public.claim_employee(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Detach the old phone-only logins. Old local part: w-<digits>. New:
--    w-<digits>-<16 hex name token>. Only the old shape is matched, so a
--    worker who has already re-activated is left alone on a re-run.
-- ---------------------------------------------------------------------------
update public.employees e
   set auth_user_id = null
  from auth.users u
 where u.id = e.auth_user_id
   and u.email ~ '^w-[0-9]+@workers\.powerplus\.local$';
