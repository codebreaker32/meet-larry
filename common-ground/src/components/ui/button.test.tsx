// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Send } from "lucide-react";
import { Button } from "./button";
import { Badge } from "./badge";
import { Skeleton, SkeletonGroup } from "./skeleton";

afterEach(cleanup);

describe("Button", () => {
  it("is a 56px pill by default and 48px when compact", () => {
    render(
      <>
        <Button>Save this step</Button>
        <Button size="sm" variant="secondary">
          Not now
        </Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Save this step" }).className).toContain("min-h-(--button-h)");
    const compact = screen.getByRole("button", { name: "Not now" });
    expect(compact.className).toContain("min-h-(--button-h-compact)");
    expect(compact.className).not.toContain("min-h-(--button-h) ");
  });

  it("defaults to type=button so it never submits a form by accident", () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole("button").getAttribute("type")).toBe("button");
  });

  it("loading: stays focusable, says it is busy, shows a spinner, keeps its words and ignores taps", () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick} icon={<Send />}>
        Send
      </Button>,
    );
    const b = screen.getByRole("button", { name: "Send" });
    expect(b.hasAttribute("disabled")).toBe(false);
    expect(b.getAttribute("aria-disabled")).toBe("true");
    expect(b.getAttribute("aria-busy")).toBe("true");
    expect(b.querySelector('[data-slot="spinner"]')).not.toBeNull();
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
    b.focus();
    expect(document.activeElement).toBe(b);
  });

  it("disabled uses aria-disabled, not the attribute, and ignores taps", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Find our common ground
      </Button>,
    );
    const b = screen.getByRole("button");
    expect(b.hasAttribute("disabled")).toBe(false);
    expect(b.getAttribute("aria-disabled")).toBe("true");
    expect(b.getAttribute("aria-busy")).toBeNull();
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("calls onClick when ready, and hides its icon from screen readers", () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} icon={<Send data-testid="icon" />}>
        Send
      </Button>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByTestId("icon").closest("[aria-hidden]")).not.toBeNull();
  });
});

describe("Badge", () => {
  it("always prints its word and is not a control", () => {
    render(<Badge>Best fit</Badge>);
    const badge = screen.getByText("Best fit");
    expect(badge.tagName).toBe("SPAN");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("variants are ink, paper with an ink ring, and a quiet outline", () => {
    render(
      <>
        <Badge>One</Badge>
        <Badge variant="paper">Two</Badge>
        <Badge variant="outline" size="md">
          Three
        </Badge>
      </>,
    );
    expect(screen.getByText("One").className).toContain("bg-ink");
    expect(screen.getByText("Two").className).toContain("ring-ink");
    expect(screen.getByText("Three").className).toContain("ring-border-subtle");
    expect(screen.getByText("Three").className).toContain("min-h-8");
  });
});

describe("Skeleton", () => {
  it("placeholders are hidden from screen readers; the group says what is loading once", () => {
    render(
      <SkeletonGroup label="Finding your common ground.">
        <Skeleton className="w-1/3" />
        <Skeleton shape="block" className="h-20 w-14" />
        <Skeleton shape="slot" className="h-24" />
      </SkeletonGroup>,
    );
    expect(screen.getByRole("status").textContent).toBe("Finding your common ground.");
    const bits = document.querySelectorAll("[data-skeleton]");
    expect(bits).toHaveLength(3);
    bits.forEach((b) => expect(b.getAttribute("aria-hidden")).toBe("true"));
  });

  it("never pulses (DESIGN.md: no shimmer, no pulse loop), and the empty slot is a dashed outline", () => {
    render(
      <>
        <Skeleton />
        <Skeleton shape="slot" />
      </>,
    );
    const [bar, slot] = Array.from(document.querySelectorAll("[data-skeleton]"));
    expect(bar.className).toContain("bg-line");
    expect(bar.className).not.toContain("animate");
    expect(slot.className).toContain("border-dashed");
    expect(slot.className).not.toContain("animate");
  });
});
