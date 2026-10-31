import { describe, expect, it } from "vitest";
import { nextMove, type HomeState } from "@/lib/next-move";
import { isRealMove, localDayKey, shouldAutoOpen, smallerMove } from "./popup-rules";

const NOW = new Date(2026, 9, 31, 9, 0);

const state = (over: Partial<HomeState> = {}): HomeState => ({
  hasCard: true,
  fingerprintSeen: true,
  peopleMet: 0,
  counters: [],
  ignoredMoves: [],
  isAdult: true,
  source: "web",
  openVisit: null,
  matchDay: null,
  ...over,
});

describe("next-move popup rules", () => {
  it("names the device's own day", () => {
    expect(localDayKey(NOW)).toBe("2026-10-31");
    expect(localDayKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });

  it("opens by itself only for a signed-in person with a card and a real step, once a day", () => {
    const move = nextMove(state(), NOW);
    expect(shouldAutoOpen({ signedIn: true, hasCard: true, move, shownOn: null, now: NOW })).toBe(true);
    expect(shouldAutoOpen({ signedIn: true, hasCard: true, move, shownOn: "2026-10-30", now: NOW })).toBe(true);
    // Already opened today.
    expect(shouldAutoOpen({ signedIn: true, hasCard: true, move, shownOn: "2026-10-31", now: NOW })).toBe(false);
    // Signed out or device-only: never.
    expect(shouldAutoOpen({ signedIn: false, hasCard: true, move, shownOn: null, now: NOW })).toBe(false);
    // No card, or no real step.
    expect(shouldAutoOpen({ signedIn: true, hasCard: false, move, shownOn: null, now: NOW })).toBe(false);
    expect(shouldAutoOpen({ signedIn: true, hasCard: true, move: null, shownOn: null, now: NOW })).toBe(false);
    const makeCard = nextMove(state({ hasCard: false }), NOW);
    expect(isRealMove(makeCard)).toBe(false);
  });

  it("offers a smaller step for a big step, using the same nextMove", () => {
    const s = state();
    const big = nextMove(s, NOW);
    expect(big.kind).toBe("second-person");
    const small = smallerMove(s, big, NOW);
    expect(small?.backOff).toBe(true);
    expect(small?.title).toBe("Was that step too big?");
    // Already small: nothing smaller.
    expect(smallerMove(s, small!, NOW)).toBeNull();
  });

  it("never shrinks a fingerprint, a plan reminder or a check-in", () => {
    const fp = state({ fingerprintSeen: false });
    expect(smallerMove(fp, nextMove(fp, NOW), NOW)).toBeNull();
    const visit = state({ openVisit: { placeId: "p1", placeName: "Dice and Tea" } });
    const m = nextMove(visit, NOW);
    expect(m.kind).toBe("check-in");
    expect(smallerMove(visit, m, NOW)).toBeNull();
  });
});
