// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

// jsdom has no matchMedia.
function stubMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }),
  });
}

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

async function load(opts: { ua?: string; firstVisit?: boolean; qr?: boolean } = {}) {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
  stubMatchMedia();
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: opts.ua ?? IPHONE });
  // A returning visitor: an earlier visit is on record, so this one is not the first.
  if (!opts.firstVisit) localStorage.setItem("larry.visit.first", "earlier-visit");
  if (opts.qr) window.history.replaceState(null, "", "/scan#t=abc");
  else window.history.replaceState(null, "", "/");
  return import("./app-card");
}

beforeEach(() => stubMatchMedia());
afterEach(() => cleanup());

describe("AppCard (offered only after a real win)", () => {
  it("shows nothing before a win", async () => {
    const { AppCard } = await load();
    render(<AppCard placement="landing" />);
    expect(screen.queryByTestId("app-card")).toBeNull();
  });

  it("after a win on a later visit it stands out with the app icon, title and benefit line", async () => {
    const { AppCard, showAppCardAfterWin } = await load();
    expect(showAppCardAfterWin("check-in")).toBe(true);
    render(<AppCard placement="win" reason="check-in" />);
    expect(screen.getByRole("heading", { name: "Get the Larry app" })).toBeTruthy();
    expect(screen.getByText("Check-ins are one tap from your home screen.")).toBeTruthy();
    // iPhone: one tap shows the picture steps.
    fireEvent.click(screen.getByRole("button", { name: "Show me how" }));
    expect(screen.getByText(/Add to Home Screen/)).toBeTruthy();
  });

  it("never on the first visit: the win only unlocks it for next time", async () => {
    const { AppCard, showAppCardAfterWin } = await load({ firstVisit: true });
    expect(showAppCardAfterWin("card-saved")).toBe(false);
    render(<AppCard placement="landing" />);
    expect(screen.queryByTestId("app-card")).toBeNull();
    expect(localStorage.getItem("larry.app.win")).toContain("card-saved");
  });

  it("never to someone whose visit began on a QR link", async () => {
    const { AppCard, showAppCardAfterWin, isQrEntry } = await load({ qr: true });
    expect(isQrEntry("https://x/join?c=abc")).toBe(false);
    expect(isQrEntry("https://x/room/ABCD")).toBe(false);
    // Friends-first: a scanned group QR is someone else's link; starting or scanning your own is not.
    expect(isQrEntry("https://x/scan#t=Q7xk2")).toBe(true);
    expect(isQrEntry("https://x/g#t=Q7xk2")).toBe(true);
    expect(isQrEntry("https://x/scan")).toBe(false);
    expect(isQrEntry("https://x/group/new")).toBe(false);
    expect(isQrEntry("https://x/create")).toBe(false);
    expect(showAppCardAfterWin("plan-ticket")).toBe(false);
    render(<AppCard placement="menu" />);
    expect(screen.queryByTestId("app-card")).toBeNull();
  });

  it("Not now hides it for 14 days; Don't ask again hides it forever", async () => {
    const mod = await load();
    mod.showAppCardAfterWin("plan-ticket");
    render(<mod.AppCard placement="landing" />);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByTestId("app-card")).toBeNull();
    const until = Number(localStorage.getItem("larry.app.snooze"));
    expect(until - Date.now()).toBeGreaterThan(13.9 * 24 * 3600 * 1000);
    expect(mod.appCardAllowed(until + 1)).toBe(true);

    localStorage.removeItem("larry.app.snooze");
    act(() => window.dispatchEvent(new Event("larry:app-card")));
    fireEvent.click(screen.getByRole("button", { name: "Don't ask again" }));
    expect(screen.queryByTestId("app-card")).toBeNull();
    expect(mod.appCardAllowed(Date.now() + 10 * 365 * 24 * 3600 * 1000)).toBe(false);
  });

  it("a win pops it at most once per visit", async () => {
    const { AppCard, showAppCardAfterWin } = await load();
    expect(showAppCardAfterWin("card-saved")).toBe(true);
    const first = render(<AppCard placement="win" reason="card-saved" />);
    expect(screen.getByTestId("app-card")).toBeTruthy();
    first.unmount();
    expect(showAppCardAfterWin("plan-ticket")).toBe(false);
    render(<AppCard placement="win" reason="plan-ticket" />);
    expect(screen.queryByTestId("app-card")).toBeNull();
  });

  it("uses the browser's own install prompt where there is one", async () => {
    const { AppCard, showAppCardAfterWin } = await load({ ua: "Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile" });
    showAppCardAfterWin("check-in");
    const prompt = vi.fn(async () => {});
    const e = Object.assign(new Event("beforeinstallprompt"), { prompt, userChoice: Promise.resolve({ outcome: "dismissed" }) });
    act(() => {
      window.dispatchEvent(e);
    });
    render(<AppCard placement="landing" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Get the app" }));
    });
    expect(prompt).toHaveBeenCalledOnce();
  });
});
