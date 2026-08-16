import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "h-11 w-full rounded-sm border border-border bg-surface px-3 text-text transition-colors",
      "focus:border-bus focus:outline-none",
      className,
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = "Select";
