import { Icon } from "@/components/Icon";
import { Input } from "@/components/ui/input";

/** Search box with magnifier + clear button. Controlled, debounce-free —
 * lists are local (Dexie), so filtering every keystroke is cheap. */
export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <Icon
        name="search"
        className="pointer-events-none absolute left-2.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted"
      />
      <Input
        type="search"
        className="pl-9 pr-9"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted"
          onClick={() => onChange("")}
        >
          ✕
        </button>
      )}
    </div>
  );
}
