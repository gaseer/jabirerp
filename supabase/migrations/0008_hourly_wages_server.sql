-- =============================================================================
-- 0008_hourly_wages_server.sql — server-side counterpart of the client Dexie
-- v8 upgrade (daily wage → hourly wage, unit model → start/end shift times).
--
-- WHY: the revised 0005 was never applied to the live project — the server
-- tables still had the pre-revision shape (employees.daily_wage_paise,
-- attendance.unit). Every employees/attendance upsert failed with
-- "column employees.hourly_wage_paise does not exist", so workers synced on
-- one device never reached any other device. This converts the live tables
-- in place using the SAME mapping the client v8 upgrade used, so converted
-- server rows and locally-converted rows agree.
--
-- The set_updated_at trigger fires on these UPDATEs, so every converted row
-- gets a fresh updated_at and all devices re-pull it on next sync.
-- Safe to run repeatedly: each block no-ops once the old column is gone.
-- =============================================================================

-- employees: daily_wage_paise → hourly_wage_paise (8h/day, same as client).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'employees'
      and column_name = 'daily_wage_paise'
  ) then
    alter table public.employees add column if not exists hourly_wage_paise bigint;

    update public.employees
      set hourly_wage_paise = round(daily_wage_paise / 8.0)
      where hourly_wage_paise is null;

    alter table public.employees alter column hourly_wage_paise set not null;
    alter table public.employees drop column daily_wage_paise;

    alter table public.employees
      drop constraint if exists employees_hourly_wage_paise_check;
    alter table public.employees
      add constraint employees_hourly_wage_paise_check
      check (hourly_wage_paise >= 0);
  end if;
end;
$$;

-- attendance: unit (full/half/custom) → start/end times + normalized hours.
-- Mapping mirrors the client: half=4h, custom=stored hours, else 8h; synthetic
-- 09:00 start, end = start + hours (capped at 23:59 to satisfy the HH:MM
-- format — only reachable for a >14.98h custom shift).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'attendance'
      and column_name = 'unit'
  ) then
    alter table public.attendance add column if not exists start_time text;
    alter table public.attendance add column if not exists end_time text;

    update public.attendance
      set hours = case
        when unit = 'half' then 4
        when unit = 'custom' then coalesce(hours, 8)
        else 8
      end
      where start_time is null;

    update public.attendance
      set start_time = '09:00',
          end_time = lpad((least(540 + round(hours * 60), 1439)::int / 60)::text, 2, '0')
            || ':'
            || lpad((least(540 + round(hours * 60), 1439)::int % 60)::text, 2, '0')
      where start_time is null;

    alter table public.attendance alter column start_time set not null;
    alter table public.attendance alter column end_time set not null;
    alter table public.attendance drop column unit;

    alter table public.attendance
      drop constraint if exists attendance_start_time_check;
    alter table public.attendance
      add constraint attendance_start_time_check
      check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
    alter table public.attendance
      drop constraint if exists attendance_end_time_check;
    alter table public.attendance
      add constraint attendance_end_time_check
      check (end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
    alter table public.attendance
      drop constraint if exists attendance_time_order;
    alter table public.attendance
      add constraint attendance_time_order check (end_time > start_time);
  end if;
end;
$$;
