// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { HomeState } from "@/lib/next-move";
import type { AuthState } from "@/components/auth/auth-provider";

const home: { state: HomeState | undefined } = { state: undefined };
vi.mock("./use-home-state", async (orig) => ({
  ...(await orig<typeof import("./use-home-state")>()),
  useHomeState: () => home.state,
}));
const auth: { value: Partial<AuthState> } = { value: { status: "signed-out", account: null } };
vi.mock("@/components/auth/auth-provider", () => ({ useAuth: () => auth.value }));
vi.mock("@/lib/persona", async (orig) => ({
  ...(await orig<typeof import("@/lib/persona")>()),
  usePersona: () => ({ version: 1, name: "Sam", likes: [{ id: "x", name: "Stardew Valley", domain: "videogame" }], dislikes: [], notes: [] }),
}));

import { NextMovePopup } from "./next-move-popup";
import { HomeTop } from "./home-top";
import { POPUP_SHOWN_KEY, localDayKey } from "./popup-rules";

// jsdom has no modal dialogs: a minimal stand-in that flips `open` and fires "close" like a browser.
beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { showModal: () => void; close: () => void };
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  proto.close = function (this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

const STATE: HomeState = {
  hasCard: true,
  fingerprintSeen: true,
  peopleMet: 0,
  counters: [],
  ignoredMoves: [],
  isAdult: true,
  source: "web",
  openVisit: null,
  matchDay: null,
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  home.state = STATE;
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("{}", { status: 404 }))));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const dialog = () => screen.queryByRole("dialog", { name: "Larry's next move" });

describe("NextMovePopup", () => {
  it("opens by itself once a day for a signed-in person with a card, as a labelled dialog", () => {
    render(<NextMovePopup signedIn />);
    expect(dialog()).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Start a group and show the QR" })).toBeTruthy();
    expect(localStorage.getItem(POPUP_SHOWN_KEY)).toBe(JSON.stringify(localDayKey(new Date())));
    cleanup();
    // Same day: only the pill.
    render(<NextMovePopup signedIn />);
    expect(dialog()).toBeNull();
    expect(screen.getByRole("button", { name: "Larry's next move" })).toBeTruthy();
  });

  it("never shows for someone who isn't signed in, or has no card", () => {
    render(<NextMovePopup signedIn={false} />);
    expect(screen.queryByRole("button", { name: "Larry's next move" })).toBeNull();
    expect(dialog()).toBeNull();
    cleanup();
    home.state = { ...STATE, hasCard: false };
    render(<NextMovePopup signedIn />);
    expect(screen.queryByRole("button", { name: "Larry's next move" })).toBeNull();
  });

  it("Something smaller swaps in a smaller step; Not now closes and is remembered", () => {
    render(<NextMovePopup signedIn />);
    fireEvent.click(screen.getByRole("button", { name: "Something smaller" }));
    const heading = screen.getByRole("heading", { name: "Was that step too big?" });
    expect(document.activeElement).toBe(heading);
    expect(screen.queryByRole("button", { name: "Something smaller" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(dialog()).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("something else next time");
    expect(JSON.parse(localStorage.getItem("larry.moves.ignored") ?? "[]")).toEqual(["second-person"]);
    // The pill opens it again.
    fireEvent.click(screen.getByRole("button", { name: "Larry's next move" }));
    expect(dialog()).not.toBeNull();
  });

  it("keeps Need help now? one tap away inside the popup", () => {
    render(<NextMovePopup signedIn />);
    fireEvent.click(screen.getByRole("button", { name: "Need help now?" }));
    expect(screen.getByRole("dialog", { name: "Need help now?" })).toBeTruthy();
  });
});

describe("HomeTop", () => {
  it("keeps the hero for visitors", () => {
    auth.value = { status: "signed-out", account: null };
    render(<HomeTop hero={<h1>Talk to someone, not something.</h1>} />);
    expect(screen.getByRole("heading", { level: 1, name: "Talk to someone, not something." })).toBeTruthy();
  });

  it("gives a signed-in person a hello and the normal buttons", () => {
    auth.value = { status: "signed-in", account: { name: "Sam" } as AuthState["account"] };
    // Already seen today, so the popup stays shut and only the pill shows.
    localStorage.setItem(POPUP_SHOWN_KEY, JSON.stringify(localDayKey(new Date())));
    render(<HomeTop hero={<h1>Talk to someone, not something.</h1>} />);
    expect(screen.getByRole("heading", { level: 1, name: "Hi, Sam." })).toBeTruthy();
    expect(screen.queryByText("Talk to someone, not something.")).toBeNull();
    expect(screen.getByRole("button", { name: "Larry's next move" })).toBeTruthy();
    expect(dialog()).toBeNull();
    for (const [name, href] of [
      ["Start a group", "/group/new"],
      ["Your groups", "/group"],
      ["Talk taste with Larry", "/larry"],
      ["Pick a pal", "/practice"],
    ]) {
      expect(screen.getByRole("link", { name }).getAttribute("href")).toBe(href);
    }
  });
});
