import type { DateRange } from "@/lib/dates";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * From/To date filter. Empty = all time. If the user enters an inverted
 * range (from > to) we swap on change rather than erroring.
 */
export function DateRangeFilter({
  range,
  onChange,
}: {
  range: DateRange;
  onChange: (range: DateRange) => void;
}) {
  function set(next: DateRange) {
    if (next.from && next.to && next.from > next.to) {
      onChange({ from: next.to, to: next.from });
    } else {
      onChange(next);
    }
  }

  const active = Boolean(range.from || range.to);

  return (
    <div className="flex items-end gap-2">
      <label className="flex-1 text-xs text-muted">
        From
        <Input
          type="date"
          className="mt-1 h-9"
          value={range.from ?? ""}
          onChange={(e) => set({ ...range, from: e.target.value || undefined })}
        />
      </label>
      <label className="flex-1 text-xs text-muted">
        To
        <Input
          type="date"
          className="mt-1 h-9"
          value={range.to ?? ""}
          onChange={(e) => set({ ...range, to: e.target.value || undefined })}
        />
      </label>
      {active && (
        <Button size="sm" variant="ghost" onClick={() => onChange({})}>
          Clear
        </Button>
      )}
    </div>
  );
}
