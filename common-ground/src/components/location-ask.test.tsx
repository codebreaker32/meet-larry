// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LocationAsk } from "./location-ask";
import { readLocationChoice, readStoredLocation } from "@/lib/location";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("LocationAsk (the one ask, D24)", () => {
  it("asks warmly with Larry's face and two choices", () => {
    render(<LocationAsk />);
    expect(screen.getByRole("heading", { name: "Larry finds real places near you. Share your location?" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Larry, an AI pal" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Share location" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Not now" })).toBeTruthy();
  });

  it("Not now remembers the choice and reads no location", () => {
    const onDone = vi.fn();
    render(<LocationAsk onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(onDone).toHaveBeenCalledWith(null);
    expect(readLocationChoice()).toBe("off");
  });

  it("Share location stores a coarse point and hands it back", async () => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition: (ok: (p: GeolocationPosition) => void) => ok({ coords: { latitude: 19.0761, longitude: 72.8777, accuracy: 30 } } as GeolocationPosition) },
    });
    const onDone = vi.fn();
    render(<LocationAsk onDone={onDone} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Share location" }));
    });
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ lat: 19.08, lon: 72.88 }));
    expect(readStoredLocation()).toMatchObject({ lat: 19.08, lon: 72.88 });
  });
});
