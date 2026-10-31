import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CURIOUS_MAX,
  HIDDEN_GEMS_MAX,
  dropPoorFits,
  findCommonGround,
  findPlaces,
  moodVibes,
  nicheMismatch,
  orderPlaces,
  ruleFit,
  signalParams,
  venueKey,
} from "./qloo";
import type { Profile } from "./types";

const A: Profile = {
  name: "Sam",
  items: [
    { id: "a1", name: "Minecraft", domain: "videogame" },
    { id: "pj", name: "Percy Jackson & the Lightning Thief", domain: "book" },
    { id: "s", name: "Spirited Away", domain: "movie" },
  ],
};
const B: Profile = {
  name: "Priya",
  items: [
    { id: "b1", name: "Heartstopper", domain: "tv_show" },
    { id: "s", name: "Spirited Away", domain: "movie" },
  ],
};

const entity = (id: string, name: string, affinity: number, contrib: Record<string, number>) => ({
  entity_id: id,
  name,
  types: ["urn:entity:movie"],
  query: { affinity, explainability: { "signal.interests.entities": Object.entries(contrib).map(([entity_id, score]) => ({ entity_id, score })) } },
});

// Four signal picks, so a pick must contribute at least 1.2 / 4 = 0.3 to count.
const RESULTS = [
  entity("lopsided", "Lopsided", 0.99, { a1: 0.9, b1: 0.02 }),
  entity("shared-only", "Only Spirited Away", 0.98, { s: 0.9 }),
  entity("sequel", "Percy Jackson: Sea of Monsters", 0.97, { pj: 0.5, b1: 0.4 }),
  entity("good", "Coco", 0.9, { a1: 0.45, b1: 0.45 }),
  entity("ok", "Paddington", 0.9, { a1: 0.6, b1: 0.31 }),
];

/** Mock Qloo: answers by which picks are in the signal (A's only, B's only, or both). */
function mockQloo(lists: { a?: unknown[]; b?: unknown[]; both?: unknown[] }) {
  const aSig = A.items.map((i) => i.id).join(",");
  const bSig = B.items.map((i) => i.id).join(",");
  const fetchMock = vi.fn(async (url: URL | string) => {
    const signal = new URL(String(url)).searchParams.get("signal.interests.entities");
    const entities = signal === aSig ? lists.a : signal === bSig ? lists.b : lists.both;
    return new Response(JSON.stringify({ results: { entities: entities ?? [] } }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const signals = (f: ReturnType<typeof mockQloo>) =>
  f.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("signal.interests.entities"));

describe("findCommonGround: combined-signal fallback", () => {
  beforeEach(() => {
    vi.stubEnv("QLOO_KEY", "test");
    // Nothing appears in both people's own lists, so the combined signal is used.
    mockQloo({ a: [], b: [], both: RESULTS });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("ranks balanced bridges first, by min(scoreA, scoreB) × affinity", async () => {
    const { bridges, shared } = await findCommonGround(A, B, ["movie"]);
    expect(shared.map((s) => s.id)).toEqual(["s"]);
    expect(bridges.slice(0, 2).map((b) => b.id)).toEqual(["good", "ok"]);
    expect(bridges[0]).toMatchObject({ fromA: ["Minecraft"], fromB: ["Heartstopper"], scoreA: 0.45, scoreB: 0.45 });
  });

  it("drops results credited only to the shared pick, and sequels of a pick", async () => {
    const ids = (await findCommonGround(A, B, ["movie"])).bridges.map((b) => b.id);
    expect(ids).not.toContain("shared-only");
    expect(ids).not.toContain("sequel");
  });

  it("throws when every Qloo call fails instead of returning nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    await expect(findCommonGround(A, B, ["movie", "book"])).rejects.toThrow();
  });
});

describe("findCommonGround: two signals", () => {
  // Credit must be at least an even share of that person's own signal: A has 3 picks (1/3), B 2 (1/2).
  const LIST_A = [
    entity("coco", "Coco", 0.95, { a1: 0.7, s: 0.3 }),
    entity("totoro", "My Neighbor Totoro", 0.9, { s: 0.8, a1: 0.2 }),
    entity("paddington", "Paddington", 0.7, { a1: 0.5, pj: 0.5 }),
    entity("only-a", "Only In A's List", 0.99, { a1: 0.9 }),
    entity("sequel", "Percy Jackson: Sea of Monsters", 0.99, { pj: 0.9 }),
    entity("weak", "Weak Credit", 0.99, { a1: 0.3, pj: 0.3 }),
  ];
  const LIST_B = [
    entity("coco", "Coco", 0.6, { b1: 0.9, s: 0.1 }),
    entity("totoro", "My Neighbor Totoro", 0.85, { s: 0.7, b1: 0.3 }),
    entity("paddington", "Paddington", 0.8, { b1: 0.65, s: 0.35 }),
    entity("only-b", "Only In B's List", 0.99, { b1: 0.9 }),
    entity("sequel", "Percy Jackson: Sea of Monsters", 0.99, { b1: 0.9 }),
    entity("weak", "Weak Credit", 0.99, { b1: 0.9 }),
  ];

  beforeEach(() => vi.stubEnv("QLOO_KEY", "test"));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("keeps only results in both lists, ranked by the weaker affinity, credited from each query", async () => {
    const f = mockQloo({ a: LIST_A, b: LIST_B, both: RESULTS });
    const { bridges } = await findCommonGround(A, B, ["movie"]);
    // Paddington: min(0.7, 0.8) = 0.7 beats Coco: min(0.95, 0.6) = 0.6.
    expect(bridges.map((b) => b.id)).toEqual(["paddington", "coco"]);
    expect(bridges[0]).toMatchObject({ affinity: 0.7, fromA: ["Minecraft"], fromB: ["Heartstopper"], scoreA: 0.5, scoreB: 0.65 });
    expect(bridges[1]).toMatchObject({ affinity: 0.6, fromA: ["Minecraft"], fromB: ["Heartstopper"] });
    // The one domain is full (2 fit per domain), so no combined call is made.
    expect(signals(f)).toHaveLength(2);
    expect(signals(f)).not.toContain("a1,pj,s,b1");
  });

  it("drops one-sided results, sequels, weak credit and results explained only by the shared pick", async () => {
    mockQloo({ a: LIST_A, b: LIST_B });
    const ids = (await findCommonGround(A, B, ["movie"])).bridges.map((b) => b.id);
    for (const id of ["only-a", "only-b", "sequel", "weak"]) expect(ids).not.toContain(id);
    // Totoro: A's top pick and B's top pick are both Spirited Away, and the runner-up credits
    // (0.2 for A, 0.3 for B) are below an even share.
    expect(ids).not.toContain("totoro");
  });

  it("asks Qloo once per person per domain, and asks the combined signal only for domains left short", async () => {
    const f = mockQloo({ a: LIST_A.slice(0, 1), b: LIST_B.slice(0, 1), both: RESULTS });
    const { bridges } = await findCommonGround(A, B, ["movie", "book"]);
    const sent = signals(f);
    expect(sent.filter((s) => s === "a1,pj,s")).toHaveLength(2);
    expect(sent.filter((s) => s === "b1,s")).toHaveLength(2);
    expect(sent.filter((s) => s === "a1,pj,s,b1")).toHaveLength(2);
    // The two-signal bridge stays first; combined-signal bridges fill in after it. (The combined
    // "good" result is also called Coco, so it is dropped as a repeat of the two-signal one.)
    expect(bridges.map((b) => b.id)).toEqual(["coco", "ok"]);
  });

  it("still answers from the combined signal when the per-person calls fail", async () => {
    const aSig = "a1,pj,s";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | string) => {
        const signal = new URL(String(url)).searchParams.get("signal.interests.entities");
        if (signal === aSig) return new Response("{}", { status: 500 });
        return new Response(JSON.stringify({ results: { entities: signal === "b1,s" ? LIST_B : RESULTS } }), { status: 200 });
      }),
    );
    const ids = (await findCommonGround(A, B, ["movie"])).bridges.map((b) => b.id);
    expect(ids.slice(0, 2)).toEqual(["good", "ok"]);
  });
});

describe("findCommonGround: mixed domains", () => {
  beforeEach(() => vi.stubEnv("QLOO_KEY", "test"));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("skips the combined call for a domain two signals already filled", async () => {
    const game = (id: string, name: string, aff: number, c: Record<string, number>) => ({ ...entity(id, name, aff, c), types: ["urn:entity:videogame"] });
    const fetchMock = vi.fn(async (url: URL | string) => {
      const p = new URL(String(url)).searchParams;
      const signal = p.get("signal.interests.entities");
      const type = p.get("filter.type");
      let entities: unknown[] = [];
      if (type === "urn:entity:videogame" && signal === "a1,pj,s") entities = [game("g1", "Stardew Valley", 0.9, { a1: 0.6 }), game("g2", "Celeste", 0.8, { pj: 0.6 })];
      if (type === "urn:entity:videogame" && signal === "b1,s") entities = [game("g1", "Stardew Valley", 0.85, { b1: 0.7 }), game("g2", "Celeste", 0.9, { b1: 0.6 })];
      if (type === "urn:entity:movie" && signal === "a1,pj,s,b1") entities = RESULTS;
      return new Response(JSON.stringify({ results: { entities } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { bridges } = await findCommonGround(A, B, ["videogame", "movie"]);
    const combinedTypes = fetchMock.mock.calls
      .map(([u]) => new URL(String(u)).searchParams)
      .filter((p) => p.get("signal.interests.entities") === "a1,pj,s,b1")
      .map((p) => p.get("filter.type"));
    expect(combinedTypes).toEqual(["urn:entity:movie"]);
    expect(bridges.map((b) => b.id).sort()).toEqual(["g1", "g2", "good", "ok"]);
  });
});

describe("findPlaces: anxiety-friendly ranking", () => {
  beforeEach(() => vi.stubEnv("QLOO_KEY", "test"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const place = (id: string, name: string, affinity: number, categories: string[]) => ({
    entity_id: id,
    name,
    types: ["urn:entity:place"],
    tags: categories.map((c) => ({ id: `urn:tag:category:place:${c}`, name: c })),
    query: { affinity, explainability: { "signal.interests.entities": [{ entity_id: "a1", score: 0.6 }] } },
  });

  it("puts a structured activity first even when a plain café scores higher", async () => {
    const byGroup: Record<string, unknown[]> = {
      board_game_club: [place("g", "Dice and Tea", 0.5, ["board_game_club"])],
      library: [place("l", "Central Library", 0.6, ["library"])],
      book_store: [place("b", "Blossom Books", 0.7, ["book_store"])],
      cafe: [place("c1", "Top Café", 0.99, ["cafe"]), place("c2", "Corner Café", 0.9, ["cafe"])],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | string) => {
        const tags = new URL(String(url)).searchParams.get("filter.tags") ?? "";
        const key = Object.keys(byGroup).find((k) => tags.includes(`:${k}`));
        return new Response(JSON.stringify({ results: { entities: key ? byGroup[key] : [] } }), { status: 200 });
      }),
    );
    const places = await findPlaces([{ id: "a1", name: "Minecraft" }], 12.97, 77.59);
    expect(places.map((p) => p.id)).toEqual(["g", "l", "b", "c1", "c2"]);
    expect(places[0].reason).toContain("You play, so it's easy to talk.");
  });

  it("sends Qloo the location to 3 decimals only, and keeps Qloo's error text out of the error", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | string) => {
        seen.push(new URL(String(url)).searchParams.get("filter.location") ?? "");
        return new Response(JSON.stringify({ results: { entities: [] } }), { status: 200 });
      }),
    );
    await findPlaces([{ id: "a1", name: "Minecraft" }], 12.9716123, 77.5946789);
    expect(new Set(seen)).toEqual(new Set(["POINT(77.595 12.972)"]));

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ errors: [{ message: "bad filter.location POINT(77.5946789 12.9716123)" }] }), { status: 400 })),
    );
    const err = await findPlaces([{ id: "a1", name: "Minecraft" }], 12.9716123, 77.5946789).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("Qloo /v2/insights failed (400)");
  });

  it("shows Qloo cover photos only from images.qloo.com", async () => {
    const withImage = (id: string, url: string) => ({ ...place(id, `Shop ${id}`, 0.5, ["book_store"]), properties: { image: { url } } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | string) => {
        const tags = new URL(String(url)).searchParams.get("filter.tags") ?? "";
        const entities = tags.includes(":book_store")
          ? [withImage("q", "https://images.qloo.com/i/abc-420x-auto.jpg"), withImage("x", "https://evil.example/i.jpg"), withImage("h", "http://images.qloo.com/i/a.jpg")]
          : [];
        return new Response(JSON.stringify({ results: { entities } }), { status: 200 });
      }),
    );
    const places = await findPlaces([{ id: "a1", name: "Minecraft" }], 12.97, 77.59);
    expect(Object.fromEntries(places.map((p) => [p.id, p.image]))).toEqual({
      q: "https://images.qloo.com/i/abc-420x-auto.jpg",
      x: undefined,
      h: undefined,
    });
  });

  it("puts quiet places before busy ones and chains last, and says why", async () => {
    const tagged = (id: string, name: string, affinity: number, extra: string[]) => {
      const p = place(id, name, affinity, ["cafe"]);
      return { ...p, tags: [...p.tags, ...extra.map((t) => ({ id: t, name: t }))] };
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | string) => {
        const tags = new URL(String(url)).searchParams.get("filter.tags") ?? "";
        const entities = tags.includes(":cafe")
          ? [
              tagged("chain", "Starbucks", 0.99, []),
              tagged("loud", "Party Café", 0.95, ["urn:tag:ambience:qloo:lively", "urn:tag:neighborhood_characteristic:qloo:bustling"]),
              tagged("plain", "Plain Café", 0.7, []),
              tagged("quiet", "Hush Café", 0.6, ["urn:tag:ambience:qloo:cozy", "urn:tag:noise_level:qloo:quiet"]),
            ]
          : tags.includes(":book_store")
            ? [place("b", "Blossom Books", 0.5, ["book_store"])]
            : [];
        return new Response(JSON.stringify({ results: { entities } }), { status: 200 });
      }),
    );
    const places = await findPlaces([{ id: "a1", name: "Minecraft" }], 12.97, 77.59);
    expect(places.map((p) => p.id)).toEqual(["b", "quiet", "plain", "chain", "loud"]);
    // The visible line is about the place; Qloo's explainability is evidence behind "Why?".
    expect(places[1].reason).toBe("A café. Easy to sit and talk. Usually quiet.");
    expect(places[1].qlooWhy).toBe("Larry found that people who like Minecraft rate this place.");
    expect(places.map((p) => p.reason).join(" ")).not.toMatch(/fans of/i);
    expect(places.at(-1)?.reason).toContain("It can get busy.");
  });
});

// ---------------------------------------------------------------- signals and place selection (1C)

describe("signals: mood, age and Hidden Gems in every Qloo call", () => {
  beforeEach(() => vi.stubEnv("QLOO_KEY", "test"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("maps Hidden Gems to filter.popularity.max, age to signal.demographics.age, mood to tags", () => {
    expect(signalParams({ hiddenGems: true }, "media")).toEqual({ "filter.popularity.max": HIDDEN_GEMS_MAX });
    expect(signalParams({ ageBucket: "25-34" }, "place")).toEqual({ "signal.demographics.age": "25_to_29" });
    expect(signalParams({ mood: "curious" }, "media")).toEqual({ "filter.popularity.max": CURIOUS_MAX });
    expect(signalParams({ mood: "chill" }, "media")["signal.interests.tags"]).toContain("urn:tag:style:qloo:cozy");
    // Hidden Gems wins over Hype's popular lean; places never get media mood tags.
    expect(signalParams({ mood: "hype", hiddenGems: true }, "media")).not.toHaveProperty("filter.popularity.min");
    expect(signalParams({ mood: "hype" }, "place")).toEqual({});
    expect(signalParams(undefined, "media")).toEqual({});
  });

  it("sends filter.popularity.max on every common-ground call when Hidden Gems is on", async () => {
    const f = mockQloo({ a: RESULTS, b: RESULTS, both: RESULTS });
    await findCommonGround(A, B, ["movie", "book"], { curate: false, signals: { hiddenGems: true, ageBucket: "18-24" } });
    expect(f.mock.calls.length).toBeGreaterThan(0);
    for (const [url] of f.mock.calls) {
      const p = new URL(String(url)).searchParams;
      expect(p.get("filter.popularity.max")).toBe(String(HIDDEN_GEMS_MAX));
      expect(p.get("signal.demographics.age")).toBe("24_and_younger");
    }
  });

  it("asks again without the signals when they leave nothing, so a mood never empties a board", async () => {
    const f = vi.fn(async (url: URL | string) => {
      const leaned = new URL(String(url)).searchParams.has("filter.popularity.max");
      return new Response(JSON.stringify({ results: { entities: leaned ? [] : RESULTS } }), { status: 200 });
    });
    vi.stubGlobal("fetch", f);
    const { bridges } = await findCommonGround(A, B, ["movie"], { curate: false, signals: { hiddenGems: true } });
    expect(bridges.length).toBeGreaterThan(0);
  });

  it("orders places by the mood's vibe: Chill calm first, Hype lively first", () => {
    const e = (id: string, noise: string) => ({ entity_id: id, name: id, tags: [{ id: `urn:tag:noise_level:qloo:${noise}` }, { id: "urn:tag:category:place:cafe" }] });
    const list = [e("loud", "loud"), e("quiet", "quiet")];
    expect(orderPlaces(list, { vibes: moodVibes("chill") }).map((x) => x.entity_id)).toEqual(["quiet", "loud"]);
    expect(orderPlaces(list, { vibes: moodVibes("hype") }).map((x) => x.entity_id)).toEqual(["loud", "quiet"]);
    // Shown lately always goes last, whatever the mood.
    expect(orderPlaces(list, { vibes: moodVibes("hype"), recent: new Set(["loud"]) }).map((x) => x.entity_id)).toEqual(["quiet", "loud"]);
  });
});

describe("place selection", () => {
  beforeEach(() => vi.stubEnv("QLOO_KEY", "test"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  const WEEK = Object.fromEntries(
    ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => [d, [{ opens: "T10:00:00", closes: "T20:00:00" }]]),
  );
  const shop = (id: string, name: string, cat: string, extra: Record<string, unknown> = {}) => ({
    entity_id: id,
    name,
    types: ["urn:entity:place"],
    tags: [{ id: `urn:tag:category:place:${cat}`, name: cat }],
    location: { lat: 19.06, lon: 72.83 },
    query: { affinity: 0.6, explainability: { "signal.interests.entities": [{ entity_id: "a1", score: 0.6 }] } },
    ...extra,
  });
  const stubPlaces = (byCat: Record<string, unknown[]>) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | string) => {
        const p = new URL(String(url)).searchParams;
        const tags = p.get("filter.tags") ?? "";
        const key = Object.keys(byCat).find((k) => tags.includes(`:${k}`));
        return new Response(JSON.stringify({ results: { entities: key ? byCat[key] : [] } }), { status: 200 });
      }),
    );

  it("drops a devotional bookshop for a gamer pair, and keeps it when someone's taste points there", async () => {
    const byCat = {
      book_store: [shop("stpaul", "St Paul Book and Art Centre", "book_store"), shop("tw", "Title Waves", "book_store")],
      board_game_club: [shop("g", "Dice Café", "board_game_club")],
    };
    stubPlaces(byCat);
    const gamers = await findPlaces([{ id: "a1", name: "Minecraft" }, { id: "b1", name: "Elden Ring" }], 19.06, 72.83);
    expect(gamers.map((p) => p.id)).not.toContain("stpaul");
    expect(nicheMismatch({ name: "Gita Press Books" }, ["Minecraft"])).toBe(true);
    expect(nicheMismatch({ name: "St Paul Book and Art Centre" }, ["The Chosen", "Bible Project"])).toBe(false);
    const believers = await findPlaces([{ id: "a1", name: "Minecraft" }], 19.06, 72.83, { tasteNames: ["Christian worship music"] });
    expect(believers.map((p) => p.id)).toContain("stpaul");
  });

  it("keeps any place with a bar away from 13-17s, even an arcade", async () => {
    const barcade = { ...shop("bar", "Barcade", "video_arcade"), tags: [{ id: "urn:tag:category:place:video_arcade" }, { id: "urn:tag:category:place:bar" }] };
    stubPlaces({ video_arcade: [barcade, shop("arc", "Pixel Arcade", "video_arcade")] });
    const adult = await findPlaces([{ id: "a1", name: "Minecraft" }], 19.06, 72.83, { signals: { ageBucket: "25-34" } });
    const teen = await findPlaces([{ id: "a1", name: "Minecraft" }], 19.06, 72.83, { signals: { ageBucket: "13-17" } });
    expect(adult.map((p) => p.id)).toContain("bar");
    expect(teen.map((p) => p.id)).toEqual(["arc"]);
  });

  it("never lists one venue twice, prefers places with real hours, and puts places shown lately last", async () => {
    stubPlaces({
      cafe: [
        shop("c1", "The Bad Cafe", "cafe"),
        shop("c1b", "The Bad Café, Bandra", "cafe"),
        shop("c2", "Cafe Mavs", "cafe", { properties: { hours: WEEK } }),
        shop("c3", "Me Time Art Cafe", "cafe", { properties: { hours: WEEK } }),
      ],
    });
    const places = await findPlaces([{ id: "a1", name: "Minecraft" }], 19.06, 72.83, { take: 3, vary: false, recent: ["c2"] });
    const names = places.map((p) => p.name);
    expect(names.filter((n) => /bad caf/i.test(n))).toHaveLength(1);
    // With hours and fresh first; the one shown lately goes last.
    expect(places[0].id).toBe("c3");
    expect(places.at(-1)!.id).toBe("c2");
    expect(venueKey("The Bad Café, Bandra")).toBe(venueKey("The Bad Cafe"));
  });

  it("leaves out places nobody plausibly fits, but keeps a choice in a thin area", () => {
    const fit = (likely: "likes" | "maybe" | "not-for-them") => [{ who: "a", likely, why: "x" }];
    const list = [
      { id: "1", fits: fit("not-for-them") },
      { id: "2", fits: fit("likes") },
      { id: "3", fits: fit("maybe") },
      { id: "4", fits: fit("maybe") },
      { id: "5", fits: fit("maybe") },
    ];
    // Everyone "not-for-them": always out.
    expect(dropPoorFits(list).map((p) => p.id)).toEqual(["2", "3", "4", "5"]);
    // No Qloo link to anyone and nobody likes it: out while 3 better places remain.
    expect(dropPoorFits(list, new Set(["2", "3", "4"])).map((p) => p.id)).toEqual(["2", "3", "4"]);
    expect(dropPoorFits(list.slice(0, 3), new Set(["2"])).map((p) => p.id)).toEqual(["2", "3"]);
  });

  it("writes rule fits that name the place and the person's own pick, never the same template", () => {
    const card = (name: string, tag: string) => ({ id: name, name, tags: [tag], affinity: 0.5, fits: [] });
    const sam = { who: "a", name: "Sam", items: [] };
    const one = ruleFit(card("Dice", "Board games"), sam, { pick: "Minecraft", topHalf: true }).why;
    const two = ruleFit(card("Pages", "Books"), sam, { pick: "Spirited Away", topHalf: true }).why;
    expect(one).toBe("Board games, and it goes with Minecraft.");
    expect(two).not.toBe(one);
    expect(ruleFit(card("Pages", "Books"), sam).why).toBe("Books. No clear link to Sam's picks yet.");
  });
});
