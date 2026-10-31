// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MoodPicker } from "./mood-picker";
import { HiddenGemsSwitch } from "./hidden-gems-switch";
import { requestSignals } from "@/lib/mood";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("MoodPicker", () => {
  it("is one tap to pick, one tap to clear, with the meaning line", () => {
    const onChange = vi.fn();
    render(<MoodPicker onChange={onChange} />);
    const chill = screen.getByRole("button", { name: "Chill" });
    act(() => fireEvent.click(chill));
    expect(chill.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Calm and close by. No rush.")).toBeTruthy();
    expect(requestSignals().mood).toBe("chill");
    act(() => fireEvent.click(chill));
    expect(chill.getAttribute("aria-pressed")).toBe("false");
    expect(requestSignals().mood).toBeUndefined();
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("compact: a pill opens the five moods and closes after a pick", () => {
    render(<MoodPicker compact />);
    const pill = screen.getByRole("button", { name: "Pick a mood" });
    act(() => fireEvent.click(pill));
    expect(screen.getAllByRole("button")).toHaveLength(6);
    act(() => fireEvent.click(screen.getByRole("button", { name: "Low energy" })));
    expect(screen.getByRole("button", { name: "Mood: Low energy" }).getAttribute("aria-expanded")).toBe("false");
  });
});

describe("HiddenGemsSwitch", () => {
  it("saves, announces and reports the change", () => {
    const onChange = vi.fn();
    render(<HiddenGemsSwitch onChange={onChange} />);
    const sw = screen.getByRole("switch", { name: /Hidden gems only/ });
    act(() => fireEvent.click(sw));
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(requestSignals().hiddenGems).toBe(true);
    expect(screen.getByText("Showing hidden gems only.")).toBeTruthy();
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("says warmly when the phone refuses to save", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    render(<HiddenGemsSwitch />);
    act(() => fireEvent.click(screen.getByRole("switch", { name: /Hidden gems only/ })));
    expect(screen.getByRole("alert").textContent).toContain("didn't save");
    spy.mockRestore();
  });
});
