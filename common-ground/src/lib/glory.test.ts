import { describe, expect, it } from "vitest";
import { addGlory, gloryForVisit, parseGlory, shownGlory } from "./glory";
import { GLORY_RULES, gloryFor } from "./types/glory";

describe("Glory", () => {
  it("pays +10 for a verified visit and +5 for saying hi, nothing for an unverified one", () => {
    expect(gloryForVisit(true, false)).toEqual({ amount: GLORY_RULES.visit, events: ["visit"] });
    expect(gloryForVisit(true, true).amount).toBe(15);
    expect(gloryForVisit(false, true).amount).toBe(0);
    expect(gloryFor([])).toBe(0);
  });

  it("never goes down", () => {
    let total = 0;
    for (const gain of [10, -50, 5, Number.NaN, -Infinity, 0, 15]) {
      const next = addGlory(total, gain);
      expect(next).toBeGreaterThanOrEqual(total);
      total = next;
    }
    expect(total).toBe(30);
    expect(addGlory(-20, 10)).toBe(10);
  });

  it("reads broken storage as 0 and shows the higher of device and server", () => {
    expect(parseGlory("abc")).toBe(0);
    expect(parseGlory("-4")).toBe(0);
    expect(parseGlory("12.7")).toBe(12);
    expect(shownGlory(40, 30)).toBe(40);
    expect(shownGlory(10, 55)).toBe(55);
    expect(shownGlory(10, null)).toBe(10);
  });
});
