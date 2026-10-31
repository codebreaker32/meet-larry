// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Segmented } from "./segmented";
import { FACES, FaceMark, FaceScale, faceWord, type FaceValue } from "./face-scale";

afterEach(cleanup);

const AGES = [
  { value: "13-17", label: "13 to 17" },
  { value: "18-24", label: "18 to 24" },
  { value: "25-34", label: "25 to 34" },
] as const;

type Age = (typeof AGES)[number]["value"];

function Ages({ initial = null, onChange }: { initial?: Age | null; onChange?: (v: Age) => void }) {
  const [v, setV] = React.useState<Age | null>(initial);
  return (
    <Segmented<Age>
      label="How old are you?"
      options={AGES}
      value={v}
      onChange={(next) => {
        setV(next);
        onChange?.(next);
      }}
    />
  );
}

describe("Segmented", () => {
  it("is a labelled radiogroup of 48px radios", () => {
    render(<Ages />);
    const group = screen.getByRole("radiogroup", { name: "How old are you?" });
    const radios = screen.getAllByRole("radio");
    expect(group).toBeTruthy();
    expect(radios).toHaveLength(3);
    radios.forEach((r) => {
      expect(r.getAttribute("aria-checked")).toBe("false");
      expect(r.className).toContain("min-h-12");
    });
  });

  it("has one Tab stop: the first option when nothing is chosen, else the chosen one", () => {
    const { unmount } = render(<Ages />);
    expect(screen.getAllByRole("radio").map((r) => r.tabIndex)).toEqual([0, -1, -1]);
    unmount();
    render(<Ages initial="25-34" />);
    expect(screen.getAllByRole("radio").map((r) => r.tabIndex)).toEqual([-1, -1, 0]);
  });

  it("a tap chooses an option", () => {
    const onChange = vi.fn();
    render(<Ages onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "18 to 24" }));
    expect(onChange).toHaveBeenCalledWith("18-24");
    expect(screen.getByRole("radio", { name: "18 to 24" }).getAttribute("aria-checked")).toBe("true");
  });

  it("arrow keys move and choose, wrapping at the ends; Home and End jump", () => {
    render(<Ages initial="13-17" />);
    const [a, b, c] = screen.getAllByRole("radio");
    fireEvent.keyDown(a, { key: "ArrowRight" });
    expect(b.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(b);
    fireEvent.keyDown(b, { key: "ArrowDown" });
    expect(c.getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(c, { key: "ArrowRight" });
    expect(a.getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(a, { key: "ArrowLeft" });
    expect(c.getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(c, { key: "Home" });
    expect(a.getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(a, { key: "End" });
    expect(c.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(c);
  });
});

describe("FaceScale", () => {
  it("is five faces with the R8 words, in order, never numbers", () => {
    render(<FaceScale label="How do you think it'll go?" value={null} onChange={() => {}} />);
    expect(screen.getByRole("radiogroup", { name: "How do you think it'll go?" })).toBeTruthy();
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["Awful", "Not great", "OK", "Good", "Great"]);
    radios.forEach((r) => expect(r.textContent).not.toMatch(/\d/));
  });

  it("every face has its own icon, and none is colour-coded", () => {
    expect(new Set(FACES.map((f) => f.Icon)).size).toBe(5);
    render(<FaceScale label="How did it go?" value={4} onChange={() => {}} />);
    const html = document.body.innerHTML;
    expect(html).not.toMatch(/(cat-|film|tv|music|games|books|sports|danger|green|red)/);
  });

  it("picking a face reports its value", () => {
    const onChange = vi.fn();
    render(<FaceScale label="How did it go?" value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "Good" }));
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it("faceWord and FaceMark give the word for a value", () => {
    expect(([1, 2, 3, 4, 5] as FaceValue[]).map(faceWord)).toEqual(["Awful", "Not great", "OK", "Good", "Great"]);
    render(<FaceMark value={2} />);
    expect(screen.getByText("Not great")).toBeTruthy();
  });
});
