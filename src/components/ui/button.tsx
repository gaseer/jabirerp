import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-sm font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
  {
    variants: {
      variant: {
        primary: "bg-primary text-white hover:bg-primary/90",
        soft: "bg-primary-soft text-primary hover:bg-primary-soft/70",
        ghost: "text-text hover:bg-border/50",
        danger: "bg-red text-white hover:bg-red/90",
      },
      size: {
        md: "h-11 px-4 text-[15px]",
        sm: "h-9 px-3 text-sm",
        block: "h-12 w-full text-[15px]",
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
