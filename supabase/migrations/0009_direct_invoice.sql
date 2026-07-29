-- =============================================================================
-- 0009_direct_invoice.sql — Slice 12. Direct invoice ("add the bill straight,
-- no quotation first"). Adds a third document kind and the extra fields an
-- invoice needs; quotation/bill rows keep NULL/0 for all of them.
--
-- Additive + idempotent: safe to re-run, and old clients (which never send the
-- new columns) keep pushing fine because every added column is nullable or
-- defaulted.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- documents: allow kind = 'invoice', add invoice header fields
-- ---------------------------------------------------------------------------
alter table public.documents
  add column if not exists doc_date date,
  add column if not exists title text,
  add column if not exists notes text,
  add column if not exists discount_paise bigint not null default 0;

-- Widen the kind CHECK. Drop-then-add because CHECK constraints can't be
-- altered in place.
alter table public.documents drop constraint if exists documents_kind_check;
alter table public.documents
  add constraint documents_kind_check
  check (kind in ('quotation', 'bill', 'invoice'));

-- A discount can never be negative (it is clamped to the subtotal client-side).
alter table public.documents drop constraint if exists documents_discount_nonneg;
alter table public.documents
  add constraint documents_discount_nonneg check (discount_paise >= 0);

-- Invoices are listed per site, newest first.
create index if not exists documents_site_kind_idx
  on public.documents (site_id, kind);

-- ---------------------------------------------------------------------------
-- line_items: section grouping + billing unit
-- ---------------------------------------------------------------------------
alter table public.line_items
  add column if not exists section text,
  add column if not exists unit text;
