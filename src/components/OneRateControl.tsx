import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toPaise } from "@/lib/money";

/** One document-wide price. Line quantities and saved item prices stay intact. */
export function OneRateControl({ value, onChange, onCommit, disabled = false }: {
  value: number | null;
  onChange: (value: number | null) => void;
  onCommit: (value: number | null) => void;
  disabled?: boolean;
}) {
  const enabled = value !== null;
  const [draft, setDraft] = useState(value ? String(value / 100) : "");
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value ? String(value / 100) : "");
  }, [value]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button" size="sm" variant={enabled ? "soft" : "ghost"}
          role="switch" aria-checked={enabled} disabled={disabled}
          onClick={() => {
            const next = enabled ? null : 0;
            onChange(next);
            onCommit(next);
          }}
        >
          One Rate for all: {enabled ? "On" : "Off"}
        </Button>
        {enabled && (
          <label className="flex items-center gap-2 text-sm text-muted">
            Total amount ₹
            <Input
              className="h-9 w-36 text-right" inputMode="decimal" placeholder="0" value={draft}
              onFocus={() => { focused.current = true; }}
              onChange={(e) => {
                setDraft(e.target.value);
                onChange(Math.max(0, toPaise(e.target.value)));
              }}
              onBlur={() => {
                focused.current = false;
                const amount = Math.max(0, toPaise(draft));
                setDraft(amount ? String(amount / 100) : "");
                onCommit(amount);
              }}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
            />
          </label>
        )}
      </div>
      {enabled && <p className="text-xs text-muted">Enter one total price for all listed items, before discount.</p>}
    </div>
  );
}
