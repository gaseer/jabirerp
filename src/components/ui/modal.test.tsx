// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WageRoundEditor } from "@/components/WageRoundEditor";
import { Modal } from "./modal";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.style.overflow = "";
});

function WageDialog({ onClose }: { onClose: (value: string) => void }) {
  const [wage, setWage] = useState("");
  const [note, setNote] = useState("");
  return (
    <Modal open onClose={() => onClose(wage)} title="Edit attendance">
      <WageRoundEditor computedPaise={75000} value={wage} onChange={setWage} />
      <input aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
    </Modal>
  );
}

/** Bypass React's value tracker, as a browser edit does before the input event. */
function typeValue(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Modal focus", () => {
  it("keeps focus on the wage input through every digit and uses the latest close callback", () => {
    const onClose = vi.fn();
    act(() => root.render(<WageDialog onClose={onClose} />));
    const input = document.getElementById("wage-round-input") as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    for (const value of ["1", "12", "123", "1234", "1234.", "1234.5", "1234.50"]) {
      typeValue(input, value);
      expect(document.getElementById("wage-round-input")).toBe(input);
      expect(document.activeElement).toBe(input);
      expect(input.value).toBe(value);
      expect(document.body.style.overflow).toBe("hidden");
    }
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith("1234.50");
  });

  it("keeps a later field focused when edits recreate the modal callback", () => {
    act(() => root.render(<WageDialog onClose={() => {}} />));
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Note"]')!;
    input.focus();
    for (const value of ["a", "ab", "abc"]) {
      typeValue(input, value);
      expect(document.activeElement).toBe(input);
    }
  });

  it("focuses again on reopening and restores scrolling when closed", () => {
    document.body.style.overflow = "auto";
    const onClose = vi.fn();
    const render = (open: boolean) => act(() => root.render(
      <Modal open={open} onClose={onClose} title="Edit item">
        <input disabled aria-label="Disabled" />
        <input aria-label="Description" />
      </Modal>,
    ));
    render(true);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Description");
    render(false);
    expect(document.body.style.overflow).toBe("auto");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).not.toHaveBeenCalled();
    render(true);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Description");
  });
});
