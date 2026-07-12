import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-11 w-full rounded-sm border border-border bg-surface px-3 text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";
