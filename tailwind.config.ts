import type { Config } from "tailwindcss";

/**
 * "Distribution board" — the visual system.
 *
 * Every colour is the logo palette (src/lib/brand.ts) or a tint of it, so the
 * app chrome, the PDFs and the letterhead read as one identity. Token NAMES are
 * deliberately unchanged from the first pass: the 24 pages address them by name
 * (`text-muted`, `bg-primary-soft`, `text-green`), so retuning values here
 * restyles the whole app without touching page code.
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        /** The enclosure: panels sit ON this, never blend into it. */
        bg: "#e7ebf1",
        surface: "#ffffff",
        border: "#d4dbe6",
        /** Ink is navy-cast, not neutral grey — legible in Kerala sun. */
        text: "#101a2b",
        muted: "#5d6b82",

        /** The logo navy. App chrome, busbars, section heads. */
        bus: { DEFAULT: "#001d4c", soft: "#0a2a63", ink: "#8fa6c9" },

        /** Live conductor — interactive, active, links. The logo blue. */
        primary: { DEFAULT: "#0b72d4", soft: "#dceafa" },
        /** Earth — money in, profit, settled. `on` = the tint used ON navy chrome. */
        green: { DEFAULT: "#0e7c4a", soft: "#ddefe4", on: "#3ec27d" },
        /** Trip — money out, overdue, destructive. The logo red. */
        red: { DEFAULT: "#d82023", soft: "#fbe3e3", on: "#ff7376" },
        amber: { DEFAULT: "#b45309", soft: "#f7ecd9", on: "#f0b357" },
        cash: { DEFAULT: "#0e6e86", soft: "#ddeef3" },
        bank: { DEFAULT: "#5b3bc4", soft: "#e9e3fa" },
      },

      fontFamily: {
        sans: ['"IBM Plex Sans"', "system-ui", "-apple-system", "sans-serif"],
        /** Panel-schedule lettering: labels, eyebrows, column heads. */
        cond: ['"IBM Plex Sans Condensed"', '"IBM Plex Sans"', "system-ui", "sans-serif"],
        /** Meter readout: headline figures and the totals column. */
        mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
      },

      /** Hard corners. A board is folded steel, not a pill. */
      borderRadius: {
        DEFAULT: "4px",
        sm: "3px",
      },

      boxShadow: {
        /** Panels sit flat on the board; the hairline border does the work. */
        card: "0 1px 0 rgba(0,29,76,.05)",
        lg: "0 24px 48px -12px rgba(0,29,76,.35)",
      },
    },
  },
  plugins: [],
} satisfies Config;
