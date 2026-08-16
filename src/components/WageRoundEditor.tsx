import { roundWageCandidates } from "@/domain/wages";
import { formatPaise, paiseToRupees, toPaise } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

/**
 * Contractor-only wage round-off control: shows the computed hours × rate
 * figure, an editable override (blank = use computed), and one-tap chips for
 * the nearest round numbers (e.g. ₹922 -> 900/950/1000). Never rendered on
 * the worker self-service side — markSelfAttendance has no override param.
 */
export function WageRoundEditor({
  computedPaise,
  value,
  onChange,
}: {
  computedPaise: number;
  /** Rupee string; "" means "use computedPaise as-is". */
  value: string;
  onChange: (v: string) => void;
}) {
  const candidates = roundWageCandidates(computedPaise);
  const finalPaise = value.trim() ? toPaise(value) : computedPaise;
  const selected = value.trim() ? Number(value) : null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <label className="text-xs text-muted" htmlFor="wage-round-input">
          Wage ₹
        </label>
        <Input
          id="wage-round-input"
          className="w-28"
          inputMode="decimal"
          placeholder={String(paiseToRupees(computedPaise))}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="figure text-text">{formatPaise(finalPaise)}</span>
        {value.trim() !== "" && (
          <button type="button" className="text-xs text-primary" onClick={() => onChange("")}>
            ↺ reset
          </button>
        )}
      </div>
      {candidates.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted">Round to:</span>
          {candidates.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onChange(String(v))}
              className={cn(
                "figure rounded-sm border px-2 py-0.5 text-xs",
                selected === v
                  ? "border-primary bg-primary-soft text-primary"
                  : "border-border text-muted hover:border-primary/50 hover:text-primary",
              )}
            >
              ₹{v.toLocaleString("en-IN")}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
