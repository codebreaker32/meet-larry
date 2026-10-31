import { describe, expect, it, vi } from "vitest";
import {
  FIXTURES,
  type Fixture,
  fixtureLine,
  fixtureWhen,
  getMatchDay,
  matchDayFallback,
  matchDayLine,
  nextFixture,
  resolveTeam,
  SCREEN_LINE,
  teamKey,
  validFixture,
} from "./matchday";
import type { TasteItem } from "./types";

const MI: TasteItem = { id: "11E8F514-0D1A-45F8-B180-06068C4F7D29", name: "Mumbai Indians", domain: "sports_team" };
const CSK: TasteItem = { id: "CSK-ID", name: "Chennai Super Kings", domain: "sports_team" };
const KOHLI: TasteItem = { id: "KOHLI-ID", name: "Virat Kohli", domain: "athlete" };
const SPIRITED: TasteItem = { id: "S", name: "Spirited Away", domain: "movie" };

// Thu 29 Oct 2026, 12:00 IST.
const NOW = new Date("2026-10-29T12:00:00+05:30");

const fixture = (over: Partial<Fixture> = {}): Fixture => ({
  league: "Test League",
  sport: "cricket",
  home: "Mumbai Indians",
  away: "Chennai Super Kings",
  homeEntityId: MI.id,
  awayEntityId: CSK.id,
  kickoffISO: "2026-10-31T15:30:00+05:30",
  tz: "Asia/Kolkata",
  sourceName: "Test schedule",
  sourceUrl: "https://example.org/schedule",
  fetchedAt: "2026-10-29",
  ...over,
});

describe("the fixtures file", () => {
  it("ships empty unless a fixture was checked by hand, and every entry is sourced", () => {
    for (const f of FIXTURES) {
      expect(f.sourceUrl).toMatch(/^https:\/\//);
      expect(f.sourceName).toBeTruthy();
      expect(f.fetchedAt).toBeTruthy();
    }
  });
});

describe("validFixture: no fixture = no date", () => {
  it("accepts a sourced afternoon game within the week", () => {
    expect(validFixture(fixture(), NOW)).toEqual({ ok: true });
  });
  it("allows an evening game that ends by about 10 pm (user decision)", () => {
    expect(validFixture(fixture({ kickoffISO: "2026-10-31T18:30:00+05:30" }), NOW).ok).toBe(true); // ends 22:00
    expect(validFixture(fixture({ kickoffISO: "2026-10-31T19:30:00+05:30" }), NOW)).toEqual({ ok: false, reason: "too-late" }); // ends 23:00
    expect(validFixture(fixture({ sport: "football", kickoffISO: "2026-10-31T20:00:00+05:30" }), NOW).ok).toBe(true); // ends 22:00
  });
  it("refuses unsourced, past, far-off, early and offset-less fixtures", () => {
    expect(validFixture(fixture({ sourceUrl: "http://example.org" }), NOW)).toEqual({ ok: false, reason: "unsourced" });
    expect(validFixture(fixture({ sourceName: "" }), NOW)).toEqual({ ok: false, reason: "unsourced" });
    expect(validFixture(fixture({ kickoffISO: "2026-10-28T15:30:00+05:30" }), NOW)).toEqual({ ok: false, reason: "past" });
    expect(validFixture(fixture({ kickoffISO: "2026-11-10T15:30:00+05:30" }), NOW)).toEqual({ ok: false, reason: "too-far" });
    expect(validFixture(fixture({ kickoffISO: "2026-10-31T06:00:00+05:30" }), NOW)).toEqual({ ok: false, reason: "too-early" });
    expect(validFixture(fixture({ kickoffISO: "2026-10-31T15:30:00" }), NOW)).toEqual({ ok: false, reason: "bad-time" });
  });
  it("judges the time in the venue's own zone (a 20:00 UK kickoff is past midnight in India, but fine in London)", () => {
    expect(validFixture(fixture({ sport: "football", kickoffISO: "2026-10-31T20:00:00+00:00", tz: "Europe/London" }), NOW).ok).toBe(true);
  });
  it("writes the day and time only from the fixture", () => {
    expect(fixtureWhen(fixture())).toBe("Sat 3:30pm");
    expect(fixtureLine(fixture())).toBe("Mumbai Indians v Chennai Super Kings, Sat 3:30pm. Fixture: Test schedule.");
  });
});

describe("resolveTeam: typed search, exact names, no namesakes", () => {
  it("passes the sports domain (so `types=` is sent) and accepts only the exact team", async () => {
    const search = vi.fn(async () => [
      { id: "MCFC", name: "Mumbai City FC", domain: "sports_team" as const },
      { id: "CLE", name: "Cleveland Guardians", domain: "sports_team" as const },
      MI,
    ]);
    expect(await resolveTeam("mumbai indians", search)).toEqual(MI);
    expect(search).toHaveBeenCalledWith("mumbai indians", "sports_team", 5);
  });
  it("never takes a namesake when the exact team isn't there", async () => {
    const search = vi.fn(async () => [{ id: "MCFC", name: "Mumbai City FC", domain: "sports_team" as const }]);
    expect(await resolveTeam("Mumbai Indians", search)).toBeNull();
    expect(await resolveTeam("Mumbai", search)).toBeNull();
  });
  it("looks up players as athletes", async () => {
    const search = vi.fn(async () => [KOHLI]);
    expect(await resolveTeam("Virat Kohli", search, "player")).toEqual(KOHLI);
    expect(search).toHaveBeenCalledWith("Virat Kohli", "athlete", 5);
  });
  it("matches across case, accents and 'FC'", () => {
    expect(teamKey("Atlético Madrid")).toBe(teamKey("atletico madrid"));
    expect(teamKey("Liverpool FC")).toBe("liverpool");
  });
});

describe("matchDayLine: the group opener's Match Day line", () => {
  it("leads when two members picked the same player, and gives the non-fan a vote", () => {
    const line = matchDayLine(
      [
        { name: "Priya", items: [KOHLI, SPIRITED] },
        { name: "Sam", items: [KOHLI] },
        { name: "Meera", items: [SPIRITED] },
      ],
      { now: NOW, fixtures: [] },
    );
    expect(line?.kind).toBe("shared");
    expect(line?.line).toBe("Priya and Sam both picked Virat Kohli. Bold. Meera, you get a vote: watch-along, or a normal plan?");
    expect(line?.fixture).toBeUndefined();
    expect(line?.line).not.toMatch(/\d/); // no date without a fixture
    expect(line!.line.split(/\s+/).length).toBeLessThan(90);
  });
  it("adds the sourced fixture only when one is valid", () => {
    const line = matchDayLine([{ name: "Priya", items: [MI] }, { name: "Sam", items: [MI] }], { now: NOW, fixtures: [fixture()] });
    expect(line?.line).toContain("Mumbai Indians v Chennai Super Kings, Sat 3:30pm. Fixture: Test schedule.");
  });
  it("one fan: only with a valid fixture, and the group chooses", () => {
    const members = [{ name: "Sam", items: [MI] }, { name: "Meera", items: [SPIRITED] }];
    expect(matchDayLine(members, { now: NOW, fixtures: [] })).toBeNull();
    const line = matchDayLine(members, { now: NOW, fixtures: [fixture()] });
    expect(line?.kind).toBe("one-fan");
    expect(line?.line).toMatch(/^Sam's team plays Sat 3:30pm\. Watch-along, or a normal plan\?/);
  });
  it("no sports picks: no line", () => {
    expect(matchDayLine([{ name: "A", items: [SPIRITED] }, { name: "B", items: [SPIRITED] }])).toBeNull();
  });
});

describe("getMatchDay and the honest fallback", () => {
  it("returns nothing without a valid fixture, never a dateless game", () => {
    expect(getMatchDay([MI.id], NOW, [])).toEqual([]);
    expect(nextFixture([MI.id], NOW, [fixture({ kickoffISO: "2026-10-28T15:30:00+05:30" })])).toBeUndefined();
  });
  it("returns the contract shape with its source when valid", () => {
    expect(getMatchDay([CSK.id], NOW, [fixture()])).toEqual([
      { team: "Chennai Super Kings", league: "Test League", fixture: { teams: "Mumbai Indians v Chennai Super Kings", when: "Sat 3:30pm" }, source: "Test schedule" },
    ]);
  });
  it("says so honestly off-season and never claims a screen", () => {
    expect(matchDayFallback("Mumbai Indians").line).toMatch(/won't make one up/);
    expect(SCREEN_LINE).toMatch(/can't promise a TV/);
  });
});
