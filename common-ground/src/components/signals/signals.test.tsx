// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BridgeCard } from "@/components/bridge-card";
import { HiddenGemsMoreOptions } from "@/components/hidden-gems-switch";
import type { Bridge } from "@/lib/types";
import { MatchDayBadge, MatchDayTicketLines } from "./match-day";
import { WhyHere } from "./why-here";
import { isLessKnown } from "./less-known-badge";

beforeEach(() => {
  localStorage.clear();
  // jsdom has no ResizeObserver (the poster measures itself).
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

const seats = [
  { name: "Sam", color: "var(--seat-1)" },
  { name: "Priya", color: "var(--seat-2)" },
];
const bridge: Bridge = { id: "x", name: "Stardew Valley", domain: "videogame", affinity: 0.9, fromA: ["Minecraft"], fromB: ["Fleet Foxes"] };

describe("Hidden gem badge: only what the server marked", () => {
  it("never shows from the request alone", () => {
    render(<BridgeCard bridge={bridge} people={seats as never} hiddenGem />);
    expect(screen.queryByText("Hidden gem")).toBeNull();
  });
  it("shows when Qloo applied the filter and returned it as less known", () => {
    render(<BridgeCard bridge={{ ...bridge, lessKnown: true } as Bridge} people={seats as never} />);
    expect(screen.getByText("Hidden gem")).toBeTruthy();
    expect(isLessKnown({ lessKnown: "yes" })).toBe(false);
  });
  it("has a badge slot for Match Day", () => {
    render(<BridgeCard bridge={bridge} people={seats as never} badge={<MatchDayBadge />} />);
    expect(screen.getByText("Match Day")).toBeTruthy();
  });
});

describe("Match Day ticket lines", () => {
  it("off-season: the honest line and no date, never a TV promise", () => {
    render(<MatchDayTicketLines info={{ team: "Mumbai Indians" }} />);
    expect(screen.getByTestId("matchday-fallback").textContent).toContain("No Mumbai Indians game I can vouch for this week");
    expect(screen.queryByTestId("matchday-fixture")).toBeNull();
    expect(screen.getByText(/can't promise a TV/)).toBeTruthy();
  });
  it("with a sourced fixture: the teams, time and source", () => {
    render(<MatchDayTicketLines info={{ fixture: { teams: "A v B", when: "Sat 3:30pm", source: "Official schedule" } }} />);
    expect(screen.getByTestId("matchday-fixture").textContent).toContain("A v B, Sat 3:30pm. Fixture: Official schedule.");
  });
});

describe("Why here?", () => {
  it("is off for a group of 2", () => {
    render(<WhyHere line="Around Mahim, all your picks show up." groupSize={2} />);
    expect(screen.queryByTestId("why-here")).toBeNull();
  });
  it("opens one sentence for 3+", () => {
    render(<WhyHere line="Around Mahim, all your picks show up." groupSize={3} />);
    const btn = screen.getByRole("button", { name: /Why here/ });
    act(() => fireEvent.click(btn));
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/No one's location is shown to anyone/)).toBeTruthy();
  });
});

describe("Hidden Gems under More options", () => {
  it("is closed and off by default, one tap opens the switch", () => {
    render(<HiddenGemsMoreOptions />);
    const more = screen.getByRole("button", { name: /More options/ });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    act(() => fireEvent.click(more));
    expect(screen.getByRole("switch", { name: /Hidden gems only/ }).getAttribute("aria-checked")).toBe("false");
  });
});
