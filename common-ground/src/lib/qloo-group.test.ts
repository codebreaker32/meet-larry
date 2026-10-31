import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GroupMember } from "./contracts";
import { findGroupCommonGround, groupDomains } from "./qloo";
import type { Domain, TasteItem } from "./types";

// Qloo is stubbed: fetch answers by which member's picks are the signal and which domain is asked.

const item = (id: string, name: string, domain: Domain): TasteItem => ({ id, name, domain });
const member = (id: string, name: string, items: TasteItem[]): GroupMember => ({ id, name, color: "var(--film)", profile: { name, items } });

const spirited = item("s", "Spirited Away", "movie");
const A = member("ma", "Sam", [item("a1", "Minecraft", "videogame"), spirited]);
const B = member("mb", "Priya", [item("b1", "Heartstopper", "tv_show"), spirited]);
const C = member("mc", "Jo", [item("c1", "Fleet Foxes", "artist")]);

const entity = (id: string, name: string, affinity: number, contrib: Record<string, number>, type = "urn:entity:movie") => ({
  entity_id: id,
  name,
  types: [type],
  properties: { image: { url: `https://images.qloo.com/i/${id}.jpg` } },
  query: { affinity, explainability: { "signal.interests.entities": Object.entries(contrib).map(([entity_id, score]) => ({ entity_id, score })) } },
});

const sig = (m: GroupMember) => m.profile.items.map((i) => i.id).join(",");

function stubQloo(lists: Record<string, unknown[]>) {
  const f = vi.fn(async (url: URL | string) => {
    const signal = new URL(String(url)).searchParams.get("signal.interests.entities") ?? "";
    return new Response(JSON.stringify({ results: { entities: lists[signal] ?? [] } }), { status: 200 });
  });
  vi.stubGlobal("fetch", f);
  return f;
}

beforeEach(() => {
  vi.stubEnv("QLOO_KEY", "test");
  vi.stubEnv("QLOO_RETRY_MS", "0");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("findGroupCommonGround", () => {
  const lists = {
    [sig(A)]: [
      entity("coco", "Coco", 0.9, { a1: 0.7, s: 0.3 }),
      entity("totoro", "My Neighbor Totoro", 0.95, { s: 0.9 }),
      entity("paddington", "Paddington", 0.8, { a1: 0.6, s: 0.4 }),
      entity("stage", "Spirited Away: The Stage Play", 0.99, { a1: 0.8 }),
    ],
    [sig(B)]: [
      entity("coco", "Coco", 0.6, { b1: 0.9 }),
      entity("totoro", "My Neighbor Totoro", 0.9, { s: 0.8 }),
      entity("paddington", "Paddington", 0.85, { b1: 0.7 }),
      entity("stage", "Spirited Away: The Stage Play", 0.99, { b1: 0.9 }),
    ],
    [sig(C)]: [entity("coco", "Coco", 0.7, { c1: 1 }), entity("up", "Up", 0.9, { c1: 1 })],
  };

  it("puts bridges more members share first, credits each member's strongest pick, and takes the weakest affinity", async () => {
    stubQloo(lists);
    const { bridges, shared } = await findGroupCommonGround([A, B, C], ["movie"]);
    expect(bridges.map((b) => b.id)).toEqual(["coco", "paddington"]);
    expect(bridges[0]).toMatchObject({
      affinity: 0.6,
      from: { ma: ["Minecraft"], mb: ["Heartstopper"], mc: ["Fleet Foxes"] },
      image: "https://images.qloo.com/i/coco.jpg",
    });
    expect(bridges[1]).toMatchObject({ affinity: 0.8, from: { ma: ["Minecraft"], mb: ["Heartstopper"] } });
    expect(shared).toEqual([{ item: spirited, memberIds: ["ma", "mb"] }]);
  });

  it("drops one-person results, sequels of a pick, and results explained only by the pick everyone shares", async () => {
    stubQloo(lists);
    const ids = (await findGroupCommonGround([A, B, C], ["movie"])).bridges.map((b) => b.id);
    for (const id of ["up", "stage", "totoro"]) expect(ids).not.toContain(id);
  });

  it("asks once per member per domain, the five core media and podcasts for 3 people and three for 5, sharing identical pick sets", async () => {
    let f = stubQloo({});
    await findGroupCommonGround([A, B, C]);
    expect(f).toHaveBeenCalledTimes(6 * 3);

    const D = member("md", "Ana", [item("d1", "Celeste", "videogame")]);
    const E = member("me", "Kai", [item("a1", "Minecraft", "videogame"), spirited]); // same picks as A
    f = stubQloo({});
    await findGroupCommonGround([A, B, C, D, E]);
    expect(f).toHaveBeenCalledTimes(3 * 4);
    const types = new Set(f.mock.calls.map(([u]) => new URL(String(u)).searchParams.get("filter.type")));
    expect(types.size).toBe(3);
  });

  it("picks the domains the group's picks cover most when there are 4-5 people", () => {
    const g = (id: string) => item(id, id, "videogame");
    const people = [member("1", "A", [g("x"), item("m", "M", "movie")]), member("2", "B", [g("y")]), member("3", "C", [item("k", "K", "book")]), member("4", "D", [])];
    expect(groupDomains(people)).toEqual(["videogame", "movie", "book"]);
  });

  it("retries once after a 429, then succeeds", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        if (calls === 1) return new Response("{}", { status: 429 });
        return new Response(JSON.stringify({ results: { entities: [] } }), { status: 200 });
      }),
    );
    await expect(findGroupCommonGround([A, C], ["movie"])).resolves.toMatchObject({ bridges: [] });
    expect(calls).toBe(3);
  });

  it("throws Qloo's error when every call fails, so the app can say Qloo is busy", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 429 })));
    await expect(findGroupCommonGround([A, C], ["movie"])).rejects.toMatchObject({ status: 429 });
  });

  it("gives everyone at least one bridge with their name on it when the data has one", async () => {
    const many = Array.from({ length: 9 }, (_, i) => entity(`ab${i}`, `Film ${String.fromCharCode(65 + i)}`, 0.9 - i * 0.01, { a1: 0.9, b1: 0.9 }));
    const bc = entity("bc", "Quiet Film", 0.3, { b1: 0.9, c1: 1 });
    stubQloo({ [sig(A)]: many, [sig(B)]: [...many, bc], [sig(C)]: [bc] });
    const { bridges } = await findGroupCommonGround([A, B, C], ["movie"]);
    expect(bridges.length).toBeLessThanOrEqual(8);
    expect(bridges.some((b) => b.from.mc)).toBe(true);
  });

  it("returns no bridges when fewer than two people have picks", async () => {
    const f = stubQloo({});
    const res = await findGroupCommonGround([A, member("x", "X", [])]);
    expect(res.bridges).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });
});
