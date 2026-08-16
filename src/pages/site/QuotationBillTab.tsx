import { useRef, useState, type FormEvent } from "react";
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
import { useEntryMode } from "@/store/settings";
import { LineItemGrid } from "@/components/grid/LineItemGrid";
import { Card, SectionHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/ui/modal";

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

type ItemFields = { description: string; qty: string; rate: string };
const BLANK_ITEM: ItemFields = { description: "", qty: "1", rate: "" };

function DocumentSection({ site, kind }: { site: SiteRow; kind: DocKind }) {
  const qc = useQueryClient();
  const siteId = site.id;
  const isBill = kind === "bill";
  const heading = isBill ? "Bill" : "Quotation";
  const excel = useEntryMode() === "excel";

  // Add-bar state (kept separate from the edit modal so an in-progress row
  // isn't clobbered when you tap an existing item to edit it).
  const [form, setForm] = useState<ItemFields>(BLANK_ITEM);
  // Non-null = editing that existing row in the modal.
  const [edit, setEdit] = useState<(ItemFields & { id: string }) | null>(null);
  // Refocus Description after each add so 100s of rows go in without re-tapping.
  const descRef = useRef<HTMLInputElement>(null);

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
    mutationFn: async (payload: ItemFields & { id?: string }) => {
      const doc = await ensureDocument(siteId, kind);
      const qty = Number(payload.qty) || 0;
      const ratePaise = toPaise(payload.rate);
      const existing = payload.id ? items.find((i) => i.id === payload.id) : undefined;
      await lineItemRepo.put({
        id: payload.id,
        document_id: doc.id,
        description: payload.description.trim(),
        qty,
        rate_paise: ratePaise,
        amount_paise: lineAmountPaise(qty, ratePaise),
        // Keep the row's position on edit; append at the end for a new row.
        position: existing?.position ?? items.length,
        // Sections/units are an invoice feature; quotation & bill lines stay flat.
        section: null,
        unit: null,
      });
      pushSoon();
    },
    onSuccess: (_void, payload) => {
      qc.invalidateQueries({ queryKey: bundleKey });
      if (payload.id) {
        setEdit(null);
      } else {
        setForm(BLANK_ITEM);
        descRef.current?.focus();
      }
    },
  });

  const removeItem = useMutation({
    mutationFn: async (itemId: string) => {
      await lineItemRepo.softDelete(itemId);
      pushSoon();
    },
    onSuccess: () => {
      setEdit(null);
      qc.invalidateQueries({ queryKey: bundleKey });
    },
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

  function submitAdd(e: FormEvent) {
    e.preventDefault();
    if (!form.description.trim() || saveItem.isPending) return;
    saveItem.mutate(form);
  }

  function submitEdit(e: FormEvent) {
    e.preventDefault();
    if (!edit || !edit.description.trim() || saveItem.isPending) return;
    saveItem.mutate(edit);
  }

  return (
    <>
      <Card className="space-y-3">
        <SectionHead
          title={heading}
          action={
            <span className="label text-[10px]">
              {items.length} {items.length === 1 ? "item" : "items"}
            </span>
          }
        />

        {excel ? (
          <LineItemGrid
            siteId={siteId}
            kind={kind}
            items={items}
            ready={bundle !== undefined}
            onChanged={() => qc.invalidateQueries({ queryKey: bundleKey })}
          />
        ) : (
          FormBody()
        )}

        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          <Button size="sm" variant="ghost" disabled={items.length === 0} onClick={sharePdf}>
            {heading} PDF
          </Button>
          <Button size="sm" variant="ghost" disabled={items.length === 0} onClick={shareExcel}>
            {heading} Excel
          </Button>
          {!isBill && (
            <Button
              size="sm"
              disabled={items.length === 0 || convert.isPending}
              onClick={() => {
                if (confirm("Convert this quotation to a bill?")) convert.mutate();
              }}
            >
              Convert to Bill
            </Button>
          )}
        </div>
      </Card>

      <Modal open={edit !== null} onClose={() => setEdit(null)} title={`Edit ${heading.toLowerCase()} item`}>
        {edit && (
          <form onSubmit={submitEdit} className="space-y-2">
            <Input
              placeholder="Description"
              value={edit.description}
              onChange={(e) => setEdit({ ...edit, description: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-muted">
                Qty
                <Input
                  className="mt-1"
                  inputMode="decimal"
                  value={edit.qty}
                  onChange={(e) => setEdit({ ...edit, qty: e.target.value })}
                />
              </label>
              <label className="text-xs text-muted">
                Rate ₹
                <Input
                  className="mt-1"
                  inputMode="decimal"
                  value={edit.rate}
                  onChange={(e) => setEdit({ ...edit, rate: e.target.value })}
                />
              </label>
            </div>
            <p className="text-sm text-muted">
              Line total:{" "}
              <span className="figure text-text">
                {formatPaise(
                  lineAmountPaise(Number(edit.qty) || 0, toPaise(edit.rate)),
                )}
              </span>
            </p>
            <div className="flex gap-2 pt-1">
              <Button type="submit" size="sm" disabled={saveItem.isPending}>
                Save changes
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setEdit(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                variant="danger"
                className="ml-auto"
                onClick={() => removeItem.mutate(edit.id)}
              >
                Delete
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );

  // ── Form mode (original one-row-at-a-time UI) ──────────────────────────────
  function FormBody() {
    return (
      <>
        {/* Add bar pinned above the list so it stays reachable at any length. */}
        <form onSubmit={submitAdd} className="space-y-2">
          <Input
            ref={descRef}
            placeholder="Description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
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
            <Button type="submit" size="md" disabled={saveItem.isPending}>
              Add
            </Button>
          </div>
          <p className="text-xs text-muted">
            Line total: <span className="figure text-text">{formatPaise(previewAmount)}</span> ·
            Enter to add — keeps typing for the next item.
          </p>
        </form>

        {items.length === 0 ? (
          <p className="border-t border-border pt-3 text-sm text-muted">
            No line items yet.
          </p>
        ) : (
          <div className="max-h-[46vh] divide-y divide-border overflow-y-auto border-t border-border">
            {items.map((it, idx) => (
              <div key={it.id} className="flex items-center gap-2 py-2">
                <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted">
                  {idx + 1}
                </span>
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() =>
                    setEdit({
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
                <div className="figure text-sm">{formatPaise(it.amount_paise)}</div>
                <button
                  className="text-muted transition-colors hover:text-red"
                  aria-label="Remove item"
                  onClick={() => removeItem.mutate(it.id)}
                >
                  <Icon name="trash" className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-border pt-2 font-semibold">
          <span>Total</span>
          <span className="figure">{formatPaise(total)}</span>
        </div>
      </>
    );
  }
}
