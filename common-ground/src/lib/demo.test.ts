import { describe, expect, it } from "vitest";
import { PERSONAS, PAIR_SEATS, seatColors } from "./demo";

describe("seat colours", () => {
  it("never gives a practice character seat a's colour", () => {
    for (const p of PERSONAS) {
      expect(p.color).not.toBe(PAIR_SEATS[0]);
      const { a, b } = seatColors(p);
      expect(b).not.toBe(a);
    }
  });

  it("falls back to seat b's colour when a character's colour matches seat a", () => {
    expect(seatColors({ color: PAIR_SEATS[0] })).toEqual({ a: PAIR_SEATS[0], b: PAIR_SEATS[1] });
    expect(seatColors()).toEqual({ a: PAIR_SEATS[0], b: PAIR_SEATS[1] });
  });
});
