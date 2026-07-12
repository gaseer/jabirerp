import type { Config } from "tailwindcss";

// Palette mirrored from the powerplus.html prototype design tokens.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#f4f6f9",
        surface: "#ffffff",
        border: "#e6e9ef",
        text: "#1c2430",
        muted: "#7b8494",
        primary: { DEFAULT: "#2563eb", soft: "#e8f0ff" },
        green: { DEFAULT: "#16a34a", soft: "#e6f6ec" },
        red: { DEFAULT: "#dc2626", soft: "#fdeaea" },
        amber: { DEFAULT: "#d97706", soft: "#fef3e2" },
        cash: { DEFAULT: "#0891b2", soft: "#e0f5f9" },
        bank: { DEFAULT: "#7c3aed", soft: "#f0e9fd" },
      },
      borderRadius: {
        DEFAULT: "14px",
        sm: "9px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,.05),0 1px 3px rgba(16,24,40,.06)",
        lg: "0 10px 30px rgba(16,24,40,.12)",
      },
    },
  },
  plugins: [],
} satisfies Config;
