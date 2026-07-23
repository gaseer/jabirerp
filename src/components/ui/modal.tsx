import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * Overlay dialog. Bottom-sheet on mobile, centered card on desktop.
 * Used for edit flows so the form appears over the tapped row instead of
 * jumping to the top of a long list. Escape / backdrop tap / ✕ all close.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Focus the first field so keyboard/typing lands in the form immediately.
    const first = panelRef.current?.querySelector<HTMLElement>(
      "input, select, textarea, button",
    );
    first?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
    >
      <div className="modal-backdrop absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={panelRef}
        className={cn(
          "modal-panel relative z-10 max-h-[88vh] w-full overflow-y-auto rounded-t bg-surface p-4 shadow-lg",
          "pb-[calc(1rem+env(safe-area-inset-bottom))] sm:mx-4 sm:max-w-md sm:rounded sm:pb-4",
          className,
        )}
      >
        {title != null && (
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="text-base font-semibold">{title}</div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-sm text-muted hover:bg-border/50"
            >
              ✕
            </button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
