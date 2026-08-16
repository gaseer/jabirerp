import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Fields read as terminals: square, hairline, and they go navy when live.
 * `focus:border-bus` rather than a glow ring — the ring is handled globally by
 * :focus-visible so keyboard users get an unmistakable outline while a mouse
 * click just darkens the edge.
 */
export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-11 w-full rounded-sm border border-border bg-surface px-3 text-text transition-colors",
      "placeholder:text-muted focus:border-bus focus:outline-none",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";
