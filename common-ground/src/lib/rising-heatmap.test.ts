import { describe, expect, it } from "vitest";
import { areaLineSafe, pickArea, whyHereAllowed, WHY_HERE_TEXT } from "./heatmap";
import { cityClaim, climbingPasses, getRising, risingMiss } from "./rising";

describe("Rising: honest, never 'rising in <city>'", () => {
  it("passes Climbing only on a real, rising series", () => {
    const up = { population_percent_delta: 0.1, population_rank_velocity: 2 };
    expect(climbingPasses([up, up, up, up])).toBe(true);
    expect(climbingPasses([])).toBe(false);
    expect(climbingPasses(null)).toBe(false);
    expect(climbingPasses([up, up, up])).toBe(false);
    expect(climbingPasses([up, up, { population_percent_delta: -0.1, population_rank_velocity: 2 }, up])).toBe(false);
    expect(climbingPasses([up, up, up, { population_percent_delta: 0.2 }])).toBe(false);
  });
  it("answers an empty list and an honest miss, with no city in it", async () => {
    expect(await getRising("Mumbai")).toEqual([]);
    const miss = risingMiss();
    expect(miss.line).toMatch(/can vouch for/);
    expect(cityClaim(miss.line)).toBe(false);
    expect(cityClaim("Gully Boy is rising in Mumbai this week.")).toBe(true);
  });
});

describe("'Why here?': off for groups of 2, never people", () => {
  it("shows only for 3-5 people with a real line", () => {
    expect(whyHereAllowed(2, "Around Mahim")).toBe(false);
    expect(whyHereAllowed(3, "Around Mahim")).toBe(true);
    expect(whyHereAllowed(6, "Around Mahim")).toBe(false);
    expect(whyHereAllowed(4, "")).toBe(false);
    expect(whyHereAllowed(undefined, "Around Mahim")).toBe(false);
  });
  it("rejects people, homes and counts", () => {
    expect(areaLineSafe("Around Mahim, Priya's Ghibli side and Sam's Minecraft side both show up strong.")).toBe(true);
    expect(areaLineSafe("Ghibli fans live here")).toBe(false);
    expect(areaLineSafe("near Sam's place")).toBe(false);
    expect(areaLineSafe("40 people like this")).toBe(false);
    expect(areaLineSafe(WHY_HERE_TEXT)).toBe(true);
  });
  it("picks no area tonight (cut), so no invented area reaches a ticket", async () => {
    expect(await pickArea({ name: "Sam", items: [] }, { lat: 19, lon: 72.8 })).toBeNull();
  });
});
