// @vitest-environment jsdom
// The states added with the component handoff (docs/components.md): busy and disabled switches,
// segmented errors and disabled groups, disabled fields, and the just-earned stamp.
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Field } from "./field";
import { Segmented } from "./segmented";
import { Stamp } from "./stamp";
import { Switch } from "./switch";

afterEach(cleanup);

describe("Switch states", () => {
  it("toggles when idle", () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onChange} label="Hidden gems only" />);
    fireEvent.click(screen.getByRole("switch", { name: /Hidden gems only/ }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("busy: stays focusable, says it is busy, ignores taps, keeps its state word", () => {
    const onChange = vi.fn();
    render(<Switch checked onCheckedChange={onChange} label="Show my check-ins to friends" busy />);
    const sw = screen.getByRole("switch");
    expect(sw.getAttribute("aria-disabled")).toBe("true");
    expect(sw.getAttribute("aria-busy")).toBe("true");
    expect(sw.hasAttribute("disabled")).toBe(false);
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(sw.textContent).toContain("On");
    fireEvent.click(sw);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disabled: aria-disabled without aria-busy", () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onChange} label="Plain words" disabled />);
    const sw = screen.getByRole("switch");
    expect(sw.getAttribute("aria-disabled")).toBe("true");
    expect(sw.hasAttribute("aria-busy")).toBe(false);
    fireEvent.click(sw);
    expect(onChange).not.toHaveBeenCalled();
  });
});

const AGES = [
  { value: "18-24", label: "18 to 24" },
  { value: "25-34", label: "25 to 34" },
] as const;

describe("Segmented states", () => {
  it("error: printed, linked with aria-describedby and marked invalid", () => {
    render(<Segmented label="How old are you?" options={AGES} value={null} onChange={() => {}} error="Pick the range you are in." />);
    const group = screen.getByRole("radiogroup", { name: "How old are you?" });
    expect(group.getAttribute("aria-invalid")).toBe("true");
    const id = group.getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)?.textContent).toBe("Pick the range you are in.");
  });

  it("no error: no describedby and not invalid", () => {
    render(<Segmented label="How old are you?" options={AGES} value={null} onChange={() => {}} />);
    const group = screen.getByRole("radiogroup");
    expect(group.hasAttribute("aria-describedby")).toBe(false);
    expect(group.hasAttribute("aria-invalid")).toBe(false);
  });

  it("disabled: taps and arrow keys never choose, but arrows still move focus", () => {
    const onChange = vi.fn();
    render(<Segmented label="How old are you?" options={AGES} value="18-24" onChange={onChange} disabled />);
    const group = screen.getByRole("radiogroup");
    const radios = screen.getAllByRole("radio");
    expect(group.getAttribute("aria-disabled")).toBe("true");
    radios.forEach((r) => expect(r.getAttribute("aria-disabled")).toBe("true"));
    fireEvent.click(radios[1]);
    radios[0].focus();
    fireEvent.keyDown(radios[0], { key: "ArrowRight" });
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(radios[1]);
    // The choice stays visible and announced.
    expect(radios[0].getAttribute("aria-checked")).toBe("true");
  });
});

describe("Field states", () => {
  it("disabled keeps the value readable (no opacity) and uses the tone change", () => {
    render(<Field label="Room code" value="7KQ2MX" onChange={() => {}} disabled />);
    const input = screen.getByLabelText("Room code") as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.className).toContain("disabled:bg-table");
    expect(input.className).toContain("disabled:text-ink-soft");
    expect(input.className).not.toMatch(/opacity/);
  });

  it("read-only stays focusable with a table ground", () => {
    render(<Field label="Your link" value="https://example.test" readOnly />);
    const input = screen.getByLabelText("Your link") as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(input.className).toContain("read-only:bg-table");
  });
});

describe("Stamp fresh state", () => {
  it("marks a just-earned stamp and deals it in with the deal tokens", () => {
    render(
      <Stamp fresh pips={1} pipsMax={5}>
        Rookie
      </Stamp>,
    );
    const stamp = screen.getByText("Rookie").closest("[data-stamp]")!;
    expect(stamp.getAttribute("data-fresh")).toBe("true");
    expect(stamp.className).toContain("ease-deal");
    expect(stamp.className).toContain("duration-(--dur-deal)");
    // Transform only: never a fade.
    expect(stamp.className).not.toMatch(/opacity/);
  });

  it("a resting stamp has no deal", () => {
    render(<Stamp>Regular</Stamp>);
    const stamp = screen.getByText("Regular").closest("[data-stamp]")!;
    expect(stamp.hasAttribute("data-fresh")).toBe(false);
    expect(stamp.className).not.toContain("ease-deal");
  });
});
