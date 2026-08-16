import { cn } from "@/lib/utils";

/**
 * Hand-drawn stroke icons — no icon library, no emoji.
 *
 * Emoji were the most templated thing in the old chrome: they render as a
 * different typeface per platform, they can't take the navy chrome's colour,
 * and 🏠👷📒 is what every app ships. These are 24×24 paths on the same 1.7px
 * stroke, drawn from the trade's own objects (a hard hat, a ruled ledger page,
 * a shop awning) so the nav looks like this business and not a template.
 */
export type IconName =
  | "home"
  | "sites"
  | "workers"
  | "ledger"
  | "shops"
  | "pnl"
  | "settings"
  | "search"
  | "edit"
  | "trash"
  | "check"
  | "close"
  | "doc"
  | "sheet"
  | "link";

const PATHS: Record<IconName, string[]> = {
  home: ["M3 10.4 12 3.2l9 7.2", "M5.6 9.4V20.4h12.8V9.4"],
  sites: [
    "M12 20.8s6.6-6.2 6.6-10.8a6.6 6.6 0 1 0-13.2 0c0 4.6 6.6 10.8 6.6 10.8Z",
    "M14.3 10a2.3 2.3 0 1 1-4.6 0 2.3 2.3 0 1 1 4.6 0Z",
  ],
  // Hard hat: brim, dome, crown straps.
  workers: ["M3 16.2h18", "M6.2 16.2v-3.1a5.8 5.8 0 0 1 11.6 0v3.1", "M9.9 7.6v8.6", "M14.1 7.6v8.6"],
  // A ruled page with a figures column — what a ledger actually looks like.
  ledger: ["M4.4 4.4h15.2v15.2H4.4z", "M15 4.4v15.2", "M4.4 9.2h15.2", "M4.4 14.4h10.6"],
  shops: ["M3 6.2h18l-1.2 3.6H4.2z", "M5 9.8V20.6h14V9.8"],
  // Profit line over an axis — up is the point.
  pnl: ["M4.2 4v16h15.6", "M7 16.2 11.4 11l3 3.1L19.4 8.2"],
  settings: ["M4.6 6.4h14.8", "M4.6 12h14.8", "M4.6 17.6h14.8", "M9.4 4.5v3.8", "M15.2 10.1v3.8", "M8.2 15.7v3.8"],
  search: ["M11 4.6a6.4 6.4 0 1 0 0 12.8 6.4 6.4 0 0 0 0-12.8Z", "M15.8 15.8 20 20"],
  // A pencil, tip to the corner — the row is being marked up, not opened.
  edit: ["M4 20h4.2L18.8 9.4a2.2 2.2 0 0 0 0-3.1L18 5.5a2.2 2.2 0 0 0-3.1 0L4.3 15.9 4 20Z", "M13 7.5l3.5 3.5"],
  // A bin: lid, body, one rib — the mark for an irreversible remove.
  trash: ["M5 7.4h14", "M9.4 7.4V5.2h5.2v2.2", "M6.6 7.4 7.3 19.6h9.4l.7-12.2", "M12 10.6v6"],
  check: ["M4.6 12.4 9.4 17.2 19.4 6.6"],
  close: ["M6 6l12 12", "M18 6 6 18"],
  // A page with a folded corner — the exported PDF.
  doc: ["M6.4 3.6h8.4l4.8 4.8v12H6.4Z", "M14.8 3.6v4.8h4.8"],
  // A page ruled into cells — the exported worksheet.
  sheet: ["M5.4 5h13.2v14H5.4z", "M5.4 10.4h13.2", "M5.4 15h13.2", "M10.6 5v14"],
  // Two linked rings — a login handed off to someone else.
  link: ["M9.8 14.2 14.2 9.8", "M11 7.4l1.6-1.6a3.3 3.3 0 0 1 4.6 4.6L15.6 12", "M13 16.6l-1.6 1.6a3.3 3.3 0 0 1-4.6-4.6L8.4 12"],
};

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={cn("h-5 w-5 shrink-0", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
