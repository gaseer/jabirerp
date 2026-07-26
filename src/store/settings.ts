import { create } from "zustand";

/**
 * App-wide UI preferences. Small enough to hand-roll localStorage persistence
 * (matching the auth store's style) instead of pulling in zustand/middleware.
 *
 * `entryMode` drives how data-entry screens render:
 *   - "excel": spreadsheet-style grid, many rows at once (default — the main
 *     user came from Excel and enters long quotations fastest this way).
 *   - "form":  the original one-record-at-a-time card forms.
 */
export type EntryMode = "excel" | "form";

const KEY = "powerplus-settings";

interface Persisted {
  entryMode: EntryMode;
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Persisted>;
      if (parsed.entryMode === "excel" || parsed.entryMode === "form") {
        return { entryMode: parsed.entryMode };
      }
    }
  } catch {
    // storage unavailable (private mode) — fall through to the default
  }
  return { entryMode: "excel" };
}

function save(state: Persisted): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // storage unavailable — preference just won't persist across reloads
  }
}

interface SettingsState extends Persisted {
  setEntryMode: (mode: EntryMode) => void;
}

export const useSettings = create<SettingsState>((set) => ({
  ...load(),
  setEntryMode: (entryMode) => {
    save({ entryMode });
    set({ entryMode });
  },
}));

/** Convenience selector — the current data-entry style. */
export const useEntryMode = () => useSettings((s) => s.entryMode);
