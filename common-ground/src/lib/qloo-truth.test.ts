// The truth fixes from qloo-hooks-plan 5.1 (P1-P3): one Qloo age value, labels only for filters
// Qloo really applied, and one "less known" line everywhere. Qloo is mocked; no real calls.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HIDDEN_GEMS_MAX, LESS_KNOWN_MAX, findCommonGround, gemDomain, gemsFor, insightsCall, isLessKnownResult, signalParams } from "./qloo";
import { MAINSTREAM_POPULARITY } from "./fingerprint";
import { AGE_BUCKETS, QLOO_AGE_MAP } from "./types/signals";
import type { Profile } from "./types";

const A: Profile = { name: "Sam", items: [{ id: "a1", name: "Minecraft", domain: "videogame" }, { id: "a2", name: "Spirited Away", domain: "movie" }] };
const B: Profile = { name: "Priya", items: [{ id: "b1", name: "Heartstopper", domain: "tv_show" }, { id: "b2", name: "Fleet Foxes", domain: "artist" }] };

const ent = (id: string, name: string, popularity: number, contrib: Record<string, number>) => ({
  entity_id: id,
  name,
  popularity,
  types: ["urn:entity:movie"],
  query: { affinity: 0.9, explainability: { "signal.interests.entities": Object.entries(contrib).map(([entity_id, score]) => ({ entity_id, score })) } },
});

function mockFetch(answer: (p: URLSearchParams) => { status?: number; entities?: unknown[] }) {
  const f = vi.fn(async (url: URL | string) => {
    const r = answer(new URL(String(url)).searchParams);
    return new Response(JSON.stringify({ results: { entities: r.entities ?? [] } }), { status: r.status ?? 200 });
  });
  vi.stubGlobal("fetch", f);
  return f;
}

beforeEach(() => vi.stubEnv("QLOO_KEY", "test"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("P1: one Qloo age value per request", () => {
  it("never sends a comma list, and every value is one of Qloo's ranges", () => {
    const qloo = new Set(["24_and_younger", "25_to_29", "30_to_34", "35_to_44", "45_to_54", "55_and_older"]);
    for (const b of AGE_BUCKETS) {
      expect(QLOO_AGE_MAP[b]).not.toContain(",");
      expect(qloo.has(QLOO_AGE_MAP[b])).toBe(true);
      expect(String(signalParams({ ageBucket: b }, "media")["signal.demographics.age"])).not.toContain(",");
    }
  });
});

describe("P3: one less-known line", () => {
  it("Hidden Gems and the Fingerprint use the same 0.9", () => {
    expect(LESS_KNOWN_MAX).toBe(0.9);
    expect(HIDDEN_GEMS_MAX).toBe(LESS_KNOWN_MAX);
    expect(MAINSTREAM_POPULARITY).toBe(LESS_KNOWN_MAX);
  });
});

describe("P2: insightsCall says what Qloo really applied", () => {
  it("reports the applied filters when the leaned call answers", async () => {
    mockFetch(() => ({ entities: [ent("x", "X", 0.5, {})] }));
    const r = await insightsCall({ "filter.type": "urn:entity:movie" }, { "filter.popularity.max": 0.9 });
    expect(r.fellBack).toBe(false);
    expect(r.appliedFilters).toEqual({ "filter.popularity.max": 0.9 });
  });

  it("falls back on a 400 or an empty answer, and says so", async () => {
    mockFetch((p) => (p.has("filter.popularity.max") ? { status: 400 } : { entities: [ent("x", "X", 0.5, {})] }));
    const r = await insightsCall({ "filter.type": "urn:entity:movie" }, { "filter.popularity.max": 0.9 });
    expect(r).toMatchObject({ fellBack: true, appliedFilters: {} });
    expect(r.entities).toHaveLength(1);
    mockFetch((p) => ({ entities: p.has("filter.popularity.max") ? [] : [ent("x", "X", 0.5, {})] }));
    expect((await insightsCall({}, { "filter.popularity.max": 0.9 })).fellBack).toBe(true);
  });

  it("calls a result less known only under an applied <= 0.9 filter and popularity under 0.9", () => {
    const applied = { appliedFilters: { "filter.popularity.max": 0.9 }, fellBack: false };
    expect(isLessKnownResult({ popularity: 0.6 }, applied)).toBe(true);
    expect(isLessKnownResult({ popularity: 0.95 }, applied)).toBe(false);
    expect(isLessKnownResult({}, applied)).toBe(false);
    expect(isLessKnownResult({ popularity: 0.6 }, { appliedFilters: {}, fellBack: true })).toBe(false);
    // Curious mood's softer 0.95 window never earns the label.
    expect(isLessKnownResult({ popularity: 0.6 }, { appliedFilters: { "filter.popularity.max": 0.95 }, fellBack: false })).toBe(false);
  });

  it("marks bridges lessKnown only when the filter held", async () => {
    const results = [ent("g", "Gem Film", 0.4, { a1: 0.5, a2: 0.5, b1: 0.5, b2: 0.5 }), ent("h", "Hit Film", 0.97, { a1: 0.5, a2: 0.5, b1: 0.5, b2: 0.5 })];
    mockFetch(() => ({ entities: results }));
    const on = await findCommonGround(A, B, ["movie"], { curate: false, signals: { hiddenGems: true } });
    const flag = (name: string, g = on) => (g.bridges.find((b) => b.name === name) as { lessKnown?: true } | undefined)?.lessKnown;
    expect(flag("Gem Film")).toBe(true);
    expect(flag("Hit Film")).toBeUndefined();

    // The filter left nothing: the fallback board carries no gem label at all.
    mockFetch((p) => ({ entities: p.has("filter.popularity.max") ? [] : results }));
    const fell = await findCommonGround(A, B, ["movie"], { curate: false, signals: { hiddenGems: true } });
    expect(fell.bridges.length).toBeGreaterThan(0);
    expect(fell.bridges.some((b) => (b as { lessKnown?: true }).lessKnown)).toBe(false);
  });
});

describe("gemsFor: one gem item for /gems", () => {
  it("targets the domain the group picked least, music/games/books only when strict", () => {
    expect(gemDomain([A, B])).toBe("book");
    expect(gemDomain([{ items: [{ id: "x", name: "x", domain: "book" }] }], true)).toBe("artist");
  });

  it("needs credit from two people in a group and labels it only when the filter held", async () => {
    const f = mockFetch(() => ({
      entities: [ent("one", "One-sided", 0.5, { a1: 0.9 }), ent("both", "Both Point Here", 0.6, { a1: 0.4, b2: 0.3 })],
    }));
    const gem = await gemsFor([A, B]);
    expect(gem?.item.name).toBe("Both Point Here");
    expect(gem?.credits).toEqual([
      { name: "Sam", pick: "Minecraft" },
      { name: "Priya", pick: "Fleet Foxes" },
    ]);
    expect(gem?.why).toContain("Sam likes Minecraft");
    expect(gem).toMatchObject({ lessKnown: true, fellBack: false });
    expect(new URL(String(f.mock.calls[0][0])).searchParams.get("filter.popularity.max")).toBe("0.9");
  });

  it("is honest when Qloo falls back: same item, no gem label", async () => {
    mockFetch((p) => ({ entities: p.has("filter.popularity.max") ? [] : [ent("both", "Both Point Here", 0.97, { a1: 0.4, b2: 0.3 })] }));
    expect(await gemsFor([A, B])).toMatchObject({ lessKnown: false, fellBack: true });
  });

  it("returns null when nothing is credited to enough people, and skips the strict deny tags", async () => {
    mockFetch(() => ({ entities: [ent("one", "One-sided", 0.5, { a1: 0.9 })] }));
    expect(await gemsFor([A, B])).toBeNull();
    mockFetch(() => ({ entities: [{ ...ent("m", "Grim", 0.5, { a1: 0.9 }), tags: [{ id: "urn:tag:genre:qloo:horror" }] }] }));
    expect(await gemsFor([A], { strict: true })).toBeNull();
  });
});
