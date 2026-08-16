import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Buttons wear the condensed uppercase label face — they are switches on a
 * board, not sentences. Hard 3px corners, no gradient, no shadow.
 */
const buttonVariants = cva(
  "label inline-flex items-center justify-center gap-2 rounded-sm transition-colors disabled:opacity-45 disabled:pointer-events-none",
  {
    variants: {
      variant: {
        primary: "bg-bus text-white hover:bg-bus-soft",
        soft: "bg-primary-soft text-primary hover:bg-primary/15",
        ghost: "border border-border bg-surface text-text hover:border-bus hover:text-bus",
        danger: "bg-red text-white hover:bg-red/90",
      },
      size: {
        md: "h-11 px-4 text-[12px]",
        sm: "h-9 px-3 text-[11px]",
        block: "h-12 w-full text-[13px]",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";
