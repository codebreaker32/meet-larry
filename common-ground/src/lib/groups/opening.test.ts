import { describe, expect, it } from "vitest";
import type { GroupGround } from "../contracts";
import { composeOpening, openingParts, sharedTeam } from "./opening";

const members = [
  { id: "s", name: "Sam" },
  { id: "p", name: "Priya" },
  { id: "a", name: "Alex" },
];

const ground = (sharedName: string): GroupGround =>
  ({
    bridges: [{ id: "b1", name: "Untitled Goose Game", domain: "videogame", from: { s: ["Spirited Away"], p: ["Fleet Foxes"], a: ["Fleet Foxes"] } }],
    shared: [{ item: { id: "i1", name: sharedName, domain: "artist" }, memberIds: ["p", "a"] }],
  }) as unknown as GroupGround;

describe("the opening's one extra", () => {
  it("never repeats a shared pick the bridge line already named", () => {
    const p = openingParts(members, ground("Fleet Foxes"), "Have you tried it?");
    expect(p.extraKind).toBe("dig");
    const { text } = composeOpening(p);
    expect(text.match(/Fleet Foxes/g)).toHaveLength(1);
  });

  it("keeps a shared pick that adds something new", () => {
    const p = openingParts(members, ground("Phoebe Bridgers"), "Have you tried it?");
    expect(p.extraKind).toBe("shared");
    expect(p.extra).toContain("Priya and Alex both picked Phoebe Bridgers");
  });
});

describe("Match Day hook", () => {
  const sports = (shared: { name: string; ids: string[] }[]): GroupGround =>
    ({
      bridges: [{ id: "rcb", name: "Royal Challengers Bengaluru", domain: "sports_team", from: { s: ["Mumbai Indians"], p: ["Chennai Super Kings"] } }],
      shared: shared.map((x) => ({ item: { id: x.name, name: x.name, domain: "sports_team" }, memberIds: x.ids })),
    }) as unknown as GroupGround;

  it("never calls a Qloo sports bridge a team they share", () => {
    expect(sharedTeam(sports([]))).toBeUndefined();
    expect(openingParts(members, sports([]), "Hi?").extraKind).not.toBe("matchday");
  });

  it("uses a team at least two of them picked", () => {
    expect(sharedTeam(sports([{ name: "Mumbai Indians", ids: ["s", "p"] }]))).toBe("Mumbai Indians");
  });
});
