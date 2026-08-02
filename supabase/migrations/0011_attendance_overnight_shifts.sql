-- Overnight shifts (end_time earlier than start_time, e.g. 17:00 -> 03:00)
-- are now allowed and stored under the start date. The old ordering
-- constraint rejected every such row on push; replace it with a guard that
-- only blocks a true zero-length shift (start_time = end_time).
alter table public.attendance
  drop constraint if exists attendance_time_order;
alter table public.attendance
  add constraint attendance_time_order check (end_time <> start_time);
