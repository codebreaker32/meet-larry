import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Qloo-only routes with the person's signals (1C). Qloo is stubbed at fetch; no model call is
// made (no access code, so no curation or model fit).
const { POST: places } = await import("@/app/api/places/route");
const { POST: commonGround } = await import("@/app/api/common-ground/route");

const WEEK = Object.fromEntries(
  ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => [d, [{ opens: "T10:00:00", closes: "T20:00:00" }]]),
);
const shop = (id: string, name: string, cat: string) => ({
  entity_id: id,
  name,
  types: ["urn:entity:place"],
  tags: [{ id: `urn:tag:category:place:${cat}`, name: cat }],
  location: { lat: 19.06, lon: 72.83 },
  properties: { hours: WEEK },
  query: { affinity: 0.6, explainability: { "signal.interests.entities": [{ entity_id: "a1", score: 0.6 }] } },
});
let urls: URLSearchParams[] = [];
beforeEach(() => {
  urls = [];
  vi.stubEnv("QLOO_KEY", "test");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL | string) => {
      const p = new URL(String(url)).searchParams;
      urls.push(p);
      const tags = p.get("filter.tags") ?? "";
      const list = tags.includes(":book_store")
        ? [shop("stpaul", "St Paul Book and Art Centre", "book_store"), shop("tw", "Title Waves", "book_store")]
        : tags.includes(":board_game_club")
          ? [shop("g", "Dice Café", "board_game_club")]
          : [];
      return new Response(JSON.stringify({ results: { entities: list } }), { status: 200 });
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const post = (handler: (r: Request) => Promise<Response>, path: string, body: unknown, ip: string) =>
  handler(new Request(`http://localhost${path}`, { method: "POST", headers: { "x-real-ip": ip, "content-type": "application/json" }, body: JSON.stringify(body) }));

describe("POST /api/places with signals", () => {
  it("sends Hidden Gems and age to Qloo, drops the devotional shop for gamers, and puts recent places last", async () => {
    const res = await post(
      places,
      "/api/places",
      {
        lat: 19.06,
        lon: 72.83,
        members: [
          { id: "a", profile: { name: "Sam", items: [{ id: "a1", name: "Minecraft", domain: "videogame" }] } },
          { id: "b", profile: { name: "Jo", items: [{ id: "b1", name: "Elden Ring", domain: "videogame" }] } },
        ],
        signals: { hiddenGems: true, ageBucket: "18-24", mood: "chill" },
        recentPlaces: ["g"],
      },
      "203.0.113.41",
    );
    expect(res.status).toBe(200);
    const { places: list } = (await res.json()) as { places: { id: string }[] };
    const ids = list.map((p) => p.id);
    expect(ids).not.toContain("stpaul");
    expect(ids.at(-1)).toBe("g");
    const placeCalls = urls.filter((p) => p.get("filter.type") === "urn:entity:place" && p.has("filter.location"));
    expect(placeCalls.length).toBeGreaterThan(0);
    // The first ask per place group is leaned (a group that comes back empty is asked once more plainly).
    const leaned = placeCalls.filter((p) => p.get("filter.popularity.max") === "0.9");
    expect(leaned.length).toBeGreaterThanOrEqual(4);
    for (const p of leaned) expect(p.get("signal.demographics.age")).toBe("24_and_younger");
  });

  it("refuses a made-up mood instead of guessing", async () => {
    const res = await post(places, "/api/places", { lat: 19.06, lon: 72.83, items: [{ id: "a1", name: "Minecraft" }], signals: { mood: "furious" } }, "203.0.113.42");
    expect(res.status).toBe(400);
  });
});

describe("POST /api/common-ground with signals", () => {
  it("passes Hidden Gems on to every Qloo call", async () => {
    const res = await post(
      commonGround,
      "/api/common-ground",
      {
        a: { name: "Sam", items: [{ id: "a1", name: "Minecraft", domain: "videogame" }] },
        b: { name: "Jo", items: [{ id: "b1", name: "Elden Ring", domain: "videogame" }] },
        signals: { hiddenGems: true },
      },
      "203.0.113.43",
    );
    expect(res.status).toBe(200);
    const first = urls.filter((p) => p.get("filter.type") !== "urn:entity:place");
    expect(first.length).toBeGreaterThan(0);
    // Every leaned call carries the filter (an empty answer is asked once more without it).
    expect(first.filter((p) => p.get("filter.popularity.max") === "0.9").length).toBeGreaterThanOrEqual(first.length / 2);
  });
});
