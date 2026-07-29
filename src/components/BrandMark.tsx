import { BRAND_NAME, BRAND_SUBTITLE, LOGO_LOCKUP_URL, LOGO_MARK_URL } from "@/lib/brand";
import { cn } from "@/lib/utils";

/**
 * The business identity in the app chrome: logo mark + trading name, matching
 * the letterhead on every shared document. `lockup` swaps in the full
 * mark+wordmark artwork (sign-in screen), where there is room for it.
 */
export function BrandMark({
  size = "md",
  lockup = false,
  className,
}: {
  size?: "sm" | "md";
  lockup?: boolean;
  className?: string;
}) {
  if (lockup) {
    return (
      <img
        src={LOGO_LOCKUP_URL}
        alt={`${BRAND_NAME} ${BRAND_SUBTITLE}`}
        className={cn("h-auto w-52 max-w-full", className)}
      />
    );
  }

  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      {/* Width auto: the bulb mark is taller than it is wide. */}
      <img
        src={LOGO_MARK_URL}
        alt=""
        className={cn("w-auto shrink-0", size === "sm" ? "h-8" : "h-10")}
      />
      <div className="min-w-0 leading-tight">
        <div
          className={cn(
            "truncate font-bold tracking-tight",
            size === "sm" ? "text-base" : "text-lg",
          )}
        >
          {BRAND_NAME}
        </div>
        <div className="truncate text-[9px] font-semibold uppercase tracking-[0.08em] text-primary">
          {BRAND_SUBTITLE}
        </div>
      </div>
    </div>
  );
}
