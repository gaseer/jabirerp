import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DocumentRow, SiteRow } from "@/lib/db";
import { sync } from "@/repo/SupabaseSync";
import { listItems } from "@/domain/documents";
import { createInvoice, invoiceTotalPaise, listInvoices } from "@/domain/invoice";
import { formatPaise } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const pushSoon = () => sync.sync().catch(() => {});

/**
 * Direct invoices for a site: bill the customer without writing a quotation
 * first. A site can hold many (part bills, extra work), each opening in the
 * full-screen editor.
 */
export function InvoicesTab({ site }: { site: SiteRow }) {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data: invoices } = useQuery({
    queryKey: ["invoices", site.id],
    queryFn: async () => {
      const docs = await listInvoices(site.id);
      return Promise.all(
        docs.map(async (doc) => ({
          doc,
          lines: await listItems(doc.id),
        })),
      );
    },
  });

  const create = useMutation({
    mutationFn: () => createInvoice(site.id),
    onSuccess: (doc: DocumentRow) => {
      qc.invalidateQueries({ queryKey: ["invoices", site.id] });
      pushSoon();
      navigate(`/invoices/${doc.id}`);
    },
  });

  const total = (invoices ?? []).reduce(
    (sum, i) => sum + invoiceTotalPaise(i.lines, i.doc.discount_paise, i.doc.lump_sum_paise),
    0,
  );

  return (
    <Card className="space-y-3">
      <div className="rule flex items-end justify-between gap-2 pb-1.5">
        <div>
          <h3 className="label text-[12px] text-bus">Invoices</h3>
          <p className="mt-1 text-xs text-muted">Bill works &amp; items directly.</p>
        </div>
        <Button size="sm" disabled={create.isPending} onClick={() => create.mutate()}>
          New invoice
        </Button>
      </div>

      {invoices === undefined ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : invoices.length === 0 ? (
        <p className="border-t border-border pt-3 text-sm text-muted">
          No invoices yet. Tap <span className="font-medium">New invoice</span> to type
          the bill straight — works and items, no quotation needed.
        </p>
      ) : (
        <>
          <div className="divide-y divide-border border-t border-border">
            {invoices.map(({ doc, lines }) => (
              <button
                key={doc.id}
                className="flex w-full items-center gap-3 py-2.5 text-left"
                onClick={() => navigate(`/invoices/${doc.id}`)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">
                      {doc.doc_number ?? "Invoice"}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-sm px-1.5 py-0.5 text-[11px] font-semibold",
                        doc.status === "final"
                          ? "bg-green-soft text-green"
                          : "bg-border/50 text-muted",
                      )}
                    >
                      {doc.status === "final" ? "Issued" : "Draft"}
                    </span>
                  </div>
                  <div className="truncate text-xs text-muted">
                    {[
                      doc.doc_date ? formatDate(doc.doc_date) : null,
                      doc.title,
                      `${lines.length} ${lines.length === 1 ? "line" : "lines"}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <div className="figure shrink-0 text-sm">
                  {formatPaise(invoiceTotalPaise(lines, doc.discount_paise, doc.lump_sum_paise))}
                </div>
                <span className="shrink-0 text-muted">›</span>
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-border pt-2 font-semibold">
            <span>Invoiced total</span>
            <span className="figure">{formatPaise(total)}</span>
          </div>
        </>
      )}
    </Card>
  );
}
