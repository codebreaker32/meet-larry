import { describe, expect, it } from "vitest";
import { DOMAIN_STYLE } from "./domain-style";
import { friendTitleFor, GLORY, nextStage, publicTitleFor, stageFor, TITLES, type TitleId } from "./titles";
import { STAGES, STAGE_VISITS } from "./types/titles";

const ids = Object.keys(TITLES) as TitleId[];

describe("title registry", () => {
  it("has the twelve titles from the user's queue", () => {
    expect(ids.sort()).toEqual(
      ["crew-leader", "elite", "final-boss", "guildmaster", "host", "legend", "party-leader", "regular", "rookie", "shogun", "squad-captain", "veteran"].sort(),
    );
  });

  it("gives every title (and Glory) a unique icon", () => {
    const icons = [...ids.map((id) => TITLES[id].Icon), GLORY.Icon];
    expect(new Set(icons).size).toBe(icons.length);
  });

  it("never reuses a category icon", () => {
    const category = new Set(Object.values(DOMAIN_STYLE).map((d) => d.Icon));
    for (const id of ids) expect(category.has(TITLES[id].Icon), id).toBe(false);
    expect(category.has(GLORY.Icon)).toBe(false);
  });

  it("uses the stage thresholds 1, 3, 6, 10, 20", () => {
    expect(STAGES.map((s) => STAGE_VISITS[s])).toEqual([1, 3, 6, 10, 20]);
    expect(STAGES.map((s) => TITLES[s].visits)).toEqual([1, 3, 6, 10, 20]);
    for (const s of STAGES) expect(TITLES[s].family).toBe("stage");
  });

  it("ranks the podium and friend titles 1 to 3, and Host apart", () => {
    expect([1, 2, 3].map((r) => publicTitleFor(r as 1 | 2 | 3))).toEqual(["final-boss", "guildmaster", "shogun"]);
    expect([1, 2, 3].map((r) => friendTitleFor(r as 1 | 2 | 3))).toEqual(["party-leader", "squad-captain", "crew-leader"]);
    for (const t of ["final-boss", "guildmaster", "shogun"] as const) expect(TITLES[t].family).toBe("public");
    expect(TITLES.host.family).toBe("friends");
    expect(TITLES.host.rank).toBeUndefined();
  });

  it("writes meanings in easy-read words", () => {
    for (const m of [...ids.map((id) => TITLES[id].meaning), GLORY.meaning]) {
      expect(m).toMatch(/^[A-Z].*\.$/);
      expect(m.split(/\s+/).length).toBeLessThanOrEqual(12);
      expect(m).not.toMatch(/[·×&→←]|\p{Extended_Pictographic}/u);
    }
  });
});

describe("stages", () => {
  it("maps visits to the stage reached", () => {
    expect(stageFor(0)).toBeNull();
    expect(stageFor(1)).toBe("rookie");
    expect(stageFor(2)).toBe("rookie");
    expect(stageFor(3)).toBe("regular");
    expect(stageFor(9)).toBe("veteran");
    expect(stageFor(10)).toBe("elite");
    expect(stageFor(20)).toBe("legend");
    expect(stageFor(500)).toBe("legend");
  });

  it("says how far the next stage is, and nothing after Legend", () => {
    expect(nextStage(0)).toEqual({ stage: "rookie", visitsAway: 1 });
    expect(nextStage(4)).toEqual({ stage: "veteran", visitsAway: 2 });
    expect(nextStage(19)).toEqual({ stage: "legend", visitsAway: 1 });
    expect(nextStage(20)).toBeNull();
  });
});
