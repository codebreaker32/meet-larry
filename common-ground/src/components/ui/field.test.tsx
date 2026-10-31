// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Gem } from "lucide-react";
import { Field, SelectField, fieldStyles } from "./field";
import { Chip } from "./chip";
import { Switch } from "./switch";

afterEach(cleanup);

describe("Field", () => {
  it("has a real label, a 56px height and a 3:1 control edge", () => {
    render(<Field label="Your name" />);
    const input = screen.getByLabelText("Your name");
    expect(input.tagName).toBe("INPUT");
    expect(input.className).toContain("min-h-(--field-h)");
    expect(input.className).toContain("border-border-control");
    expect(input.className).not.toMatch(/border-ink\/\d+/);
  });

  it("links the hint and the error, and marks the field invalid only with an error", () => {
    const { rerender } = render(<Field label="Room code" hint="Six letters, from the host's screen." />);
    const input = screen.getByLabelText("Room code");
    const hint = screen.getByText("Six letters, from the host's screen.");
    expect(input.getAttribute("aria-describedby")).toBe(hint.id);
    expect(input.getAttribute("aria-invalid")).toBeNull();

    rerender(<Field label="Room code" hint="Six letters, from the host's screen." error="Try the six letters again." />);
    const err = screen.getByText("Try the six letters again.");
    expect(input.getAttribute("aria-describedby")?.split(" ")).toEqual([hint.id, err.id]);
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("keeps a caller's aria-describedby and id", () => {
    render(<Field label="Name" id="name" aria-describedby="extra" hint="Hint" />);
    const input = screen.getByLabelText("Name");
    expect(input.id).toBe("name");
    expect(input.getAttribute("aria-describedby")).toBe("extra name-hint");
  });

  it("a hidden label still names the field", () => {
    render(<Field label="Search pictures" hideLabel />);
    expect(screen.getByLabelText("Search pictures")).toBeTruthy();
    expect(screen.getByText("Search pictures").className).toContain("sr-only");
  });

  it("compact fields are still 48px", () => {
    expect(fieldStyles("sm")).toContain("min-h-12");
  });

  it("SelectField is labelled and shares the control edge", () => {
    render(
      <SelectField label="When">
        <option>Saturday</option>
      </SelectField>,
    );
    const select = screen.getByLabelText("When");
    expect(select.tagName).toBe("SELECT");
    expect(select.className).toContain("border-border-control");
  });
});

describe("Chip", () => {
  it("is a 48px choice chip with aria-pressed when pressed is given", () => {
    render(
      <>
        <Chip pressed>Calm</Chip>
        <Chip pressed={false}>Lively</Chip>
        <Chip>Tell me more</Chip>
      </>,
    );
    const calm = screen.getByRole("button", { name: "Calm" });
    expect(calm.getAttribute("aria-pressed")).toBe("true");
    expect(calm.className).toContain("bg-ink");
    expect(calm.className).toContain("min-h-(--chip-h)");
    expect(screen.getByRole("button", { name: "Lively" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Tell me more" }).hasAttribute("aria-pressed")).toBe(false);
  });

  it("busy is a tone change that ignores taps and stays focusable", () => {
    const onClick = vi.fn();
    render(
      <Chip busy onClick={onClick}>
        Yes
      </Chip>,
    );
    const chip = screen.getByRole("button", { name: "Yes" });
    expect(chip.getAttribute("aria-disabled")).toBe("true");
    expect(chip.hasAttribute("disabled")).toBe(false);
    fireEvent.click(chip);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("Switch", () => {
  it("is a role=switch with aria-checked, and prints its state as a word", () => {
    render(<Switch checked={false} onCheckedChange={() => {}} label="Hidden gems only" icon={<Gem />} />);
    const sw = screen.getByRole("switch", { name: /Hidden gems only/ });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(sw.textContent).toContain("Off");
    expect(sw.className).toContain("min-h-(--chip-h)");
  });

  it("tapping asks for the other state", () => {
    const onCheckedChange = vi.fn();
    const { rerender } = render(<Switch checked={false} onCheckedChange={onCheckedChange} label="Show my check-ins to friends" />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);

    rerender(<Switch checked onCheckedChange={onCheckedChange} label="Show my check-ins to friends" />);
    const sw = screen.getByRole("switch");
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(sw.textContent).toContain("On");
    fireEvent.click(sw);
    expect(onCheckedChange).toHaveBeenLastCalledWith(false);
  });

  it("links its description", () => {
    render(<Switch checked onCheckedChange={() => {}} label="Hidden gems only" description="Showing hidden gems only." />);
    const sw = screen.getByRole("switch");
    const desc = screen.getByText("Showing hidden gems only.");
    expect(sw.getAttribute("aria-describedby")).toBe(desc.id);
  });
});
