import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DocKind, SiteRow } from "@/lib/db";
import { lineItemRepo } from "@/repo/repos";
import { sync } from "@/repo/SupabaseSync";
import {
  convertToBill,
  ensureDocument,
  getDocByKind,
  listItems,
} from "@/domain/documents";
import { documentTotalPaise, lineAmountPaise } from "@/domain/quotation";
import { shareDocumentPdf } from "@/lib/pdf";
import { shareDocumentXlsx } from "@/lib/xlsx";
import { formatPaise, toPaise } from "@/lib/money";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const pushSoon = () => sync.sync().catch(() => {});

/** Quotation until converted, then the bill (moved verbatim from SiteDetail). */
export function QuotationBillTab({ site }: { site: SiteRow }) {
  const { data: quotationDoc } = useQuery({
    queryKey: ["quotation-status", site.id],
    queryFn: async () => (await getDocByKind(site.id, "quotation")) ?? null,
  });
  const showBill = quotationDoc?.status === "converted";
  return <DocumentSection site={site} kind={showBill ? "bill" : "quotation"} />;
}

function DocumentSection({ site, kind }: { site: SiteRow; kind: DocKind }) {
  const qc = useQueryClient();
  const siteId = site.id;
  const isBill = kind === "bill";
  const heading = isBill ? "Bill" : "Quotation";

  const [form, setForm] = useState<{
    id?: string;
    description: string;
    qty: string;
    rate: string;
  }>({ description: "", qty: "1", rate: "" });

  const bundleKey = ["docbundle", siteId, kind];
  const { data: bundle } = useQuery({
    queryKey: bundleKey,
    queryFn: async () => {
      const doc = (await getDocByKind(siteId, kind)) ?? null;
      const items = doc ? await listItems(doc.id) : [];
      return { doc, items };
    },
  });

  const items = bundle?.items ?? [];
  const total = documentTotalPaise(items);
  const previewAmount = lineAmountPaise(Number(form.qty) || 0, toPaise(form.rate));

  const saveItem = useMutation({
    mutationFn: async () => {
      const doc = await ensureDocument(siteId, kind);
      const qty = Number(form.qty) || 0;
      const ratePaise = toPaise(form.rate);
      const existing = form.id ? items.find((i) => i.id === form.id) : undefined;
      await lineItemRepo.put({
        id: form.id,
        document_id: doc.id,
        description: form.description.trim(),
        qty,
        rate_paise: ratePaise,
        amount_paise: lineAmountPaise(qty, ratePaise),
        // Keep the row's position on edit; append at the end for a new row.
        position: existing?.position ?? items.length,
      });
      pushSoon();
    },
    onSuccess: () => {
      setForm({ description: "", qty: "1", rate: "" });
      qc.invalidateQueries({ queryKey: bundleKey });
    },
  });

  const removeItem = useMutation({
    mutationFn: async (itemId: string) => {
      await lineItemRepo.softDelete(itemId);
      pushSoon();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: bundleKey }),
  });

  const convert = useMutation({
    mutationFn: async () => {
      await convertToBill(siteId);
      pushSoon();
    },
    onSuccess: () => qc.invalidateQueries(),
  });

  async function sharePdf() {
    await shareDocumentPdf(site, kind, items);
  }

  async function shareExcel() {
    await shareDocumentXlsx(site, kind, items);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.description.trim()) return;
    saveItem.mutate();
  }

  return (
    <>
      <Card className="space-y-3">
        <div className="font-semibold">{heading}</div>

        {items.length === 0 ? (
          <p className="text-sm text-muted">No line items yet.</p>
        ) : (
          <div className="divide-y divide-border">
            {items.map((it) => (
              <div key={it.id} className="flex items-center gap-2 py-2">
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() =>
                    setForm({
                      id: it.id,
                      description: it.description,
                      qty: String(it.qty),
                      rate: String(it.rate_paise / 100),
                    })
                  }
                >
                  <div className="truncate">{it.description || "(no description)"}</div>
                  <div className="text-xs text-muted">
                    {it.qty} × {formatPaise(it.rate_paise)}
                  </div>
                </button>
                <div className="font-medium">{formatPaise(it.amount_paise)}</div>
                <button
                  className="text-red"
                  aria-label="Remove item"
                  onClick={() => removeItem.mutate(it.id)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-border pt-2 font-semibold">
          <span>Total</span>
          <span>{formatPaise(total)}</span>
        </div>

        <form onSubmit={submit} className="space-y-2 border-t border-border pt-3">
          <Input
            placeholder="Description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <div className="grid grid-cols-3 gap-2">
            <Input
              placeholder="Qty"
              inputMode="decimal"
              value={form.qty}
              onChange={(e) => setForm({ ...form, qty: e.target.value })}
            />
            <Input
              placeholder="Rate ₹"
              inputMode="decimal"
              value={form.rate}
              onChange={(e) => setForm({ ...form, rate: e.target.value })}
            />
            <div className="flex items-center justify-end pr-1 text-sm text-muted">
              {formatPaise(previewAmount)}
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={saveItem.isPending}>
              {form.id ? "Update item" : "＋ Add item"}
            </Button>
            {form.id && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setForm({ description: "", qty: "1", rate: "" })}
              >
                Cancel
              </Button>
            )}
          </div>
        </form>

        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          <Button size="sm" variant="soft" disabled={items.length === 0} onClick={sharePdf}>
            📄 Share {heading} PDF
          </Button>
          <Button size="sm" variant="soft" disabled={items.length === 0} onClick={shareExcel}>
            📊 Share {heading} Excel
          </Button>
          {!isBill && (
            <Button
              size="sm"
              disabled={items.length === 0 || convert.isPending}
              onClick={() => {
                if (confirm("Convert this quotation to a bill?")) convert.mutate();
              }}
            >
              → Convert to Bill
            </Button>
          )}
        </div>
      </Card>
    </>
  );
}
