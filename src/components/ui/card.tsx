import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A panel face: white, hairline edge, flat on the board. No drop shadow — the
 * old soft-shadow card is the look every app ships, and shadows go muddy on a
 * phone screen in daylight. Separation comes from the edge and the ground.
 */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded border border-border bg-surface p-4", className)}
      {...props}
    />
  );
}

/**
 * Section head in the schedule language: condensed caps over a heavy navy
 * rule, with room for one action on the right. Use it instead of hand-rolling
 * a bold div, so every block on every page divides the same way.
 */
export function SectionHead({
  title,
  action,
  className,
}: {
  title: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rule flex items-end justify-between gap-3 pb-1.5", className)}>
      <h3 className="label text-[12px] text-bus">{title}</h3>
      {action}
    </div>
  );
}
