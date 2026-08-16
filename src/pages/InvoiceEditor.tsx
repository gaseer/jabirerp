import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DocumentRow } from "@/lib/db";
import { documentRepo, siteRepo } from "@/repo/repos";
import { sync } from "@/repo/SupabaseSync";
import { getDocByKind, listItems } from "@/domain/documents";
import {
  deleteInvoice,
  importItemsFrom,
  invoiceTotals,
  listItemLibrary,
} from "@/domain/invoice";
import { shareInvoicePdf } from "@/lib/pdf";
import { shareInvoiceXlsx } from "@/lib/xlsx";
import { formatPaise, toPaise } from "@/lib/money";
import { InvoiceGrid } from "@/components/grid/InvoiceGrid";
import { Card, SectionHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const pushSoon = () => sync.sync().catch(() => {});

/**
 * Direct invoice editor — the "type the bill straight" screen. Its own route
 * (not a tab) so the sheet gets the full width, with a sticky total bar that
 * stays visible however long the invoice grows.
 *
 * Header fields are saved on blur; line items save themselves (see InvoiceGrid).
 */
export function InvoiceEditor() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  // Live subtotal straight off the grid, so the total bar tracks typing
  // instead of lagging behind the save debounce.
  const [liveSubtotal, setLiveSubtotal] = useState<number | null>(null);

  const bundleKey = ["invoice", id];
  const { data: bundle } = useQuery({
    queryKey: bundleKey,
    queryFn: async () => {
      const doc = (await documentRepo.getById(id)) ?? null;
      if (!doc) return { doc: null, site: null, items: [], quotationId: null };
      const [site, items, quotation] = await Promise.all([
        siteRepo.getById(doc.site_id),
        listItems(doc.id),
        getDocByKind(doc.site_id, "quotation"),
      ]);
      return {
        doc,
        site: site ?? null,
        items,
        quotationId: quotation?.id ?? null,
      };
    },
  });

  const { data: library } = useQuery({
    queryKey: ["item-library"],
    queryFn: listItemLibrary,
  });

  const doc = bundle?.doc ?? null;
  const site = bundle?.site ?? null;
  const items = bundle?.items ?? [];

  const saveHeader = useMutation({
    mutationFn: async (patch: Partial<DocumentRow>) => {
      if (!doc) return;
      await documentRepo.put({ ...doc, ...patch });
      pushSoon();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: bundleKey }),
  });

  const importQuotation = useMutation({
    mutationFn: async () => {
      if (!doc || !bundle?.quotationId) return 0;
      const count = await importItemsFrom(doc.id, bundle.quotationId);
      pushSoon();
      return count;
    },
    onSuccess: () => qc.invalidateQueries(),
  });

  const remove = useMutation({
    mutationFn: async () => {
      await deleteInvoice(id);
      pushSoon();
    },
    onSuccess: () => {
      qc.invalidateQueries();
      if (doc) navigate(`/sites/${doc.site_id}?tab=invoices`, { replace: true });
    },
  });

  if (bundle && (!doc || !site)) {
    return (
      <div className="space-y-4">
        <button className="text-primary" onClick={() => navigate("/sites")}>
          ← Sites
        </button>
        <Card className="text-muted">Invoice not found.</Card>
      </div>
    );
  }
  if (!bundle || !doc || !site) return <Card className="text-muted">Loading…</Card>;

  // Grid subtotal until it reports in (first render / no lines yet).
  const totals = invoiceTotals(
    liveSubtotal === null
      ? items
      : [{ amount_paise: liveSubtotal }],
    doc.discount_paise,
  );
  const issued = doc.status === "final";

  async function sharePdf() {
    // Flush any debounced line edit by re-reading what is actually persisted.
    if (doc) await shareInvoicePdf(site!, doc, await listItems(doc.id));
  }

  async function shareExcel() {
    if (doc) await shareInvoiceXlsx(site!, doc, await listItems(doc.id));
  }

  return (
    <div className="space-y-4 pb-20">
      <button
        className="text-primary"
        onClick={() => navigate(`/sites/${doc.site_id}?tab=invoices`)}
      >
        ← {site.name}
      </button>

      <Card className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-xl">Invoice</h2>
            <p className="text-sm text-muted">
              {site.name}
              {site.location ? ` · ${site.location}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              saveHeader.mutate({ status: issued ? "draft" : "final" })
            }
            className={cn(
              "label rounded-sm px-1.5 py-1",
              issued ? "bg-green-soft text-green" : "bg-border/50 text-muted",
            )}
            title="Tap to switch between Draft and Issued"
          >
            {issued ? "Issued" : "Draft"}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-muted">
            Invoice no.
            <HeaderField
              className="mt-1"
              value={doc.doc_number ?? ""}
              onCommit={(v) => saveHeader.mutate({ doc_number: v.trim() || null })}
            />
          </label>
          <label className="text-xs text-muted">
            Date
            <HeaderField
              className="mt-1"
              type="date"
              value={doc.doc_date ?? ""}
              onCommit={(v) => saveHeader.mutate({ doc_date: v || null })}
            />
          </label>
        </div>
        <label className="block text-xs text-muted">
          Work title (optional)
          <HeaderField
            className="mt-1"
            placeholder="e.g. Ground floor wiring"
            value={doc.title ?? ""}
            onCommit={(v) => saveHeader.mutate({ title: v.trim() || null })}
          />
        </label>
      </Card>

      <Card className="space-y-3">
        <SectionHead
          title="Works &amp; items"
          action={
            bundle.quotationId && (
              <Button
                size="sm"
                variant="ghost"
                disabled={importQuotation.isPending}
                onClick={() => {
                  if (confirm("Copy every line from this site's quotation into the invoice?"))
                    importQuotation.mutate();
                }}
              >
                Pull in quotation lines
              </Button>
            )
          }
        />

        <InvoiceGrid
          documentId={doc.id}
          items={items}
          ready={bundle !== undefined}
          library={library ?? []}
          onChanged={() => {
            qc.invalidateQueries({ queryKey: bundleKey });
            qc.invalidateQueries({ queryKey: ["site-pnl", doc.site_id] });
            qc.invalidateQueries({ queryKey: ["invoices", doc.site_id] });
          }}
          onSubtotalChange={setLiveSubtotal}
        />
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted">Subtotal</span>
          <span className="figure text-sm">
            {formatPaise(totals.subtotalPaise)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <label className="text-sm text-muted" htmlFor="invoice-discount">
            Discount ₹
          </label>
          <HeaderField
            id="invoice-discount"
            className="h-9 w-32 text-right"
            inputMode="decimal"
            value={doc.discount_paise ? String(doc.discount_paise / 100) : ""}
            placeholder="0"
            onCommit={(v) => saveHeader.mutate({ discount_paise: toPaise(v) })}
          />
        </div>
        <label className="block text-xs text-muted">
          Notes on the invoice (optional)
          <HeaderField
            className="mt-1"
            placeholder="Payment terms, thanks, warranty…"
            value={doc.notes ?? ""}
            onCommit={(v) => saveHeader.mutate({ notes: v.trim() || null })}
          />
        </label>

        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          <Button size="sm" variant="ghost" disabled={items.length === 0} onClick={sharePdf}>
            Invoice PDF
          </Button>
          <Button size="sm" variant="ghost" disabled={items.length === 0} onClick={shareExcel}>
            Invoice Excel
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-red"
            onClick={() => {
              if (confirm("Delete this invoice and all its lines?")) remove.mutate();
            }}
          >
            Delete invoice
          </Button>
        </div>
      </Card>

      {/*
        Sticky so the number the customer will see is never scrolled away.
        Sits above the mobile bottom nav (64px + safe area) and clears the
        desktop sidebar (220px).
      */}
      <div className="fixed bottom-[calc(66px+env(safe-area-inset-bottom))] left-0 right-0 z-20 border-t border-border bg-surface/95 backdrop-blur md:bottom-0 md:left-[232px]">
        <div className="mx-auto flex max-w-[920px] items-center justify-between gap-3 px-4 py-3">
          <div className="text-xs text-muted">
            {items.length} {items.length === 1 ? "line" : "lines"}
            {totals.discountPaise > 0 && ` · less ${formatPaise(totals.discountPaise)}`}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-sm text-muted">Total</span>
            <span className="figure text-xl">
              {formatPaise(totals.totalPaise)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Text input that keeps its own draft while focused and reports the value once
 * on blur (or Enter) — so a header save never fires per keystroke, and the
 * field never fights the query result mid-typing.
 */
function HeaderField({
  value,
  onCommit,
  className,
  ...rest
}: {
  value: string;
  onCommit: (value: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <Input
      {...rest}
      className={className}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}
