import { BRAND_NAME, BRAND_SUBTITLE, LOGO_LOCKUP_URL, LOGO_MARK_URL } from "@/lib/brand";
import { cn } from "@/lib/utils";

/**
 * The business identity in the app chrome: logo mark + trading name, matching
 * the letterhead on every shared document. `lockup` swaps in the full
 * mark+wordmark artwork (sign-in screen), where there is room for it.
 *
 * `tone="light"` is the version that sits on the navy chrome — the subtitle
 * flips from the logo blue (invisible on navy) to the chrome's own tint.
 */
export function BrandMark({
  size = "md",
  lockup = false,
  tone = "dark",
  className,
}: {
  size?: "sm" | "md";
  lockup?: boolean;
  tone?: "dark" | "light";
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
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      {/* Width auto: the bulb mark is taller than it is wide. */}
      <img
        src={LOGO_MARK_URL}
        alt=""
        className={cn("w-auto shrink-0", size === "sm" ? "h-8" : "h-10")}
      />
      <div className="min-w-0 leading-none">
        <div
          className={cn(
            "truncate font-cond font-bold uppercase tracking-[0.06em]",
            size === "sm" ? "text-[17px]" : "text-[20px]",
            tone === "light" ? "text-white" : "text-bus",
          )}
        >
          {BRAND_NAME}
        </div>
        <div
          className={cn(
            "label mt-1 truncate text-[8.5px]",
            tone === "light" ? "text-bus-ink" : "text-primary",
          )}
        >
          {BRAND_SUBTITLE}
        </div>
      </div>
    </div>
  );
}
