import logoMarkUrl from "@/assets/logo-mark.png";
import logoLockupUrl from "@/assets/logo.png";

/**
 * Single source of truth for the business identity. Everything customer-facing
 * — PDFs, Excel exports, the app chrome, the PWA manifest — reads from here, so
 * changing a phone number or the trading name is a one-line edit.
 *
 * The name is printed UPPERCASE on documents (it is a trading name, and the
 * logo sets it that way).
 */
export const BRAND_NAME = "POWER PLUS";
export const BRAND_SUBTITLE = "ELECTRICAL AND PLUMBING WORKS";
export const BRAND_FULL = `${BRAND_NAME} ${BRAND_SUBTITLE}`;

/** Contact lines under the letterhead. Empty strings are skipped, not printed blank. */
export const BRAND_PHONE = "+91 90617 20700";
export const BRAND_EMAIL = "";
export const BRAND_ADDRESS = "";

/** Palette sampled from the logo artwork — reused for every PDF accent. */
export const BRAND_COLORS = {
  navy: "#001d4c",
  blue: "#0b72d4",
  /** The logo's red — the accent rule under the letterhead. */
  accent: "#d82023",
  ink: "#1c2430",
  muted: "#7b8494",
  tint: "#eef3fb",
  hairline: "#d8e0ec",
} as const;

/**
 * The bulb mark (no wordmark) — letterhead, app chrome, PWA icon. It is TALLER
 * than it is wide, so anything drawing it must size from the height and use
 * this ratio for the width; a square box would squash it.
 */
export const LOGO_MARK_URL = logoMarkUrl;
export const LOGO_MARK_ASPECT = 183 / 300; // width ÷ height of the asset
/** Full lockup (mark + wordmark + phone) — the sign-in screen. */
export const LOGO_LOCKUP_URL = logoLockupUrl;

/** Contact lines that are actually set, in print order. */
export function brandContactLines(): string[] {
  return [BRAND_ADDRESS, [BRAND_PHONE, BRAND_EMAIL].filter(Boolean).join("  ·  ")].filter(
    (l) => l.trim() !== "",
  );
}

let logoDataUrl: Promise<string | null> | null = null;

/**
 * The logo as a data URL, for jsPDF's addImage. Fetched once and memoised; the
 * PNG is precached by the service worker, so this also works offline. Any
 * failure resolves to null and the PDF simply prints without the mark rather
 * than failing to generate.
 */
export function loadBrandLogo(): Promise<string | null> {
  logoDataUrl ??= fetch(LOGO_MARK_URL)
    .then((res) => (res.ok ? res.blob() : Promise.reject(new Error("logo fetch failed"))))
    .then(
      (blob) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        }),
    )
    .catch(() => null);
  return logoDataUrl;
}
