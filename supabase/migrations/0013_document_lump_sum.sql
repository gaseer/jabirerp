-- One Rate for all: NULL keeps existing item pricing; a non-negative value
-- is the single price for the whole document, before its discount.
alter table public.documents
  add column if not exists lump_sum_paise bigint;

alter table public.documents
  drop constraint if exists documents_lump_sum_nonneg;
alter table public.documents
  add constraint documents_lump_sum_nonneg
  check (lump_sum_paise is null or lump_sum_paise >= 0);

-- No backfill: existing documents remain in item-pricing mode (NULL).
