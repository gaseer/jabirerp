import { useOnline } from "@/hooks/useOnline";
import { useAuth } from "@/store/auth";
import { useSettings, type EntryMode } from "@/store/settings";
import { Card, SectionHead } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/Icon";
import { cn } from "@/lib/utils";

/** App preferences: data-entry style + account. */
export function Settings() {
  const entryMode = useSettings((s) => s.entryMode);
  const setEntryMode = useSettings((s) => s.setEntryMode);
  const online = useOnline();
  const email = useAuth((s) => s.user?.email);
  const signOut = useAuth((s) => s.signOut);

  return (
    <div className="space-y-4">
      <h2 className="text-xl">Settings</h2>

      <Card className="space-y-3">
        <SectionHead
          title={
            <div className="font-sans normal-case tracking-normal">
              <div className="text-sm font-semibold text-text">Data entry style</div>
              <p className="mt-0.5 text-xs font-normal text-muted">
                How you add line items, expenses, advances and attendance.
              </p>
            </div>
          }
        />

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <ModeCard
            active={entryMode === "excel"}
            onClick={() => setEntryMode("excel")}
            icon="sheet"
            title="Excel / table"
            desc="Type many rows at once in a spreadsheet grid — Enter jumps to the next row. Best for long quotations."
            mode="excel"
          />
          <ModeCard
            active={entryMode === "form"}
            onClick={() => setEntryMode("form")}
            icon="edit"
            title="Simple form"
            desc="Add one record at a time with a card form. Fewer fields on screen at once."
            mode="form"
          />
        </div>

        <p className="text-xs text-muted">
          You can switch anytime — it changes every entry screen instantly.
        </p>
      </Card>

      <Card className="space-y-3">
        <SectionHead title="Account" />
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="truncate text-muted">{email ?? "Not signed in"}</span>
          <span
            className={cn(
              "label flex shrink-0 items-center gap-1.5",
              online ? "text-green" : "text-amber",
            )}
          >
            <span
              className={cn("h-1.5 w-1.5 rounded-full", online ? "bg-green" : "bg-amber")}
            />
            {online ? "Online" : "Offline"}
          </span>
        </div>
        <Button variant="soft" size="sm" onClick={signOut}>
          Sign out
        </Button>
      </Card>
    </div>
  );
}

function ModeCard({
  active,
  onClick,
  icon,
  title,
  desc,
  mode,
}: {
  active: boolean;
  onClick: () => void;
  icon: IconName;
  title: string;
  desc: string;
  mode: EntryMode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-sm border p-3 text-left transition-colors",
        active
          ? "border-primary bg-primary-soft/50 ring-1 ring-primary/40"
          : "border-border hover:bg-border/30",
      )}
    >
      <div className="flex items-center justify-between">
        <Icon name={icon} className={cn("h-5 w-5", active ? "text-primary" : "text-muted")} />
        {active && (
          <span className="label flex items-center gap-1 text-primary">
            <Icon name="check" className="h-3 w-3" />
            Selected
          </span>
        )}
      </div>
      <div className="mt-1 font-semibold">
        {title}
        {mode === "excel" && (
          <span className="ml-1 text-[11px] font-medium text-muted">(default)</span>
        )}
      </div>
      <p className="mt-0.5 text-xs text-muted">{desc}</p>
    </button>
  );
}
