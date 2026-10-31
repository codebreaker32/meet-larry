import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Larry's curation of common ground. Anthropic and Qloo are both stubbed: no real calls.
const h = vi.hoisted(() => {
  process.env.ANTHROPIC_SPEND_FILE = `${process.env.TMPDIR ?? "/tmp"}/larry-curation-test-${process.pid}.json`;
  return {
    reply: "" as string | (() => never),
    calls: 0,
    params: undefined as undefined | Record<string, unknown>,
  };
});

vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    beta = {
      messages: {
        create: async (params: Record<string, unknown>) => {
          h.calls++;
          h.params = params;
          const text = typeof h.reply === "function" ? h.reply() : h.reply;
          return { content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 2000, output_tokens: 600 } };
        },
      },
    };
  }
  return { default: Anthropic };
});

const { validCuration, namesAPick, balanceByPick } = await import("./suggest");
const { findCommonGround, findGroupCommonGround, plainWhy, coveragePool } = await import("./qloo");
import type { GroupMember } from "./contracts";
import type { Profile } from "./types";

const A: Profile = { name: "Sam", items: [{ id: "a1", name: "Minecraft", domain: "videogame" }, { id: "a2", name: "Spirited Away", domain: "movie" }] };
const B: Profile = { name: "Priya", items: [{ id: "b1", name: "Fleet Foxes", domain: "artist" }, { id: "b2", name: "Little Women", domain: "movie" }] };

const people = [
  { key: "a", name: "Sam", picks: ["Minecraft", "Spirited Away"] },
  { key: "b", name: "Priya", picks: ["Fleet Foxes", "Little Women"], dislikes: ["Horror Film"] },
];
const cands = ["Stardew Valley", "Howl's Moving Castle", "Joe Hisaishi", "Horror Film", "Anne with an E"].map((name, i) => ({
  id: `c${i}`,
  name,
  domain: "movie",
  credits: { a: "Minecraft", b: "Fleet Foxes" },
}));
const why = (n: string) => `${n} has cosy building like Minecraft for Sam and a gentle folk mood Priya knows from Fleet Foxes.`;

describe("coverage across each person's picks", () => {
  it("builds the pool round-robin by contributing pick, so one pick can't fill it", () => {
    // 12 candidates from Gilmore Girls, then one each from Sam's other picks.
    const ranked = [
      ...Array.from({ length: 12 }, (_, i) => ({ id: `g${i}`, name: ["Alpha", "Bravo", "Comet", "Delta", "Ember", "Fjord", "Gusto", "Harbor", "Iris", "Jolt", "Kite", "Lumen"][i], domain: (["movie", "tv_show", "book", "artist"] as const)[i % 4], from: "Gilmore Girls" })),
      { id: "i1", name: "Space Film", domain: "movie" as const, from: "Interstellar" },
      { id: "d1", name: "Robot Album", domain: "artist" as const, from: "Daft Punk" },
    ];
    const pool = coveragePool(ranked, (c) => [`a:${c.from}`]);
    expect(pool.map((c) => c.id)).toEqual(expect.arrayContaining(["i1", "d1"]));
    expect(pool.filter((c) => c.from === "Gilmore Girls").length).toBeLessThanOrEqual(5);
    // Someone with only one pick behind everything isn't capped.
    expect(coveragePool(ranked.slice(0, 12), (c) => [`a:${c.from}`]).length).toBe(12);
  });

  it("drops the lowest items of a pick that drives more than half of a curation", () => {
    const cands = ["x1", "x2", "x3", "x4", "y1", "z1"].map((id) => ({ id, name: id, domain: "movie", credits: { a: id.startsWith("x") ? "Gilmore Girls" : id.startsWith("y") ? "Interstellar" : "Daft Punk" } }));
    const folks = [{ key: "a", name: "Sam", picks: ["Gilmore Girls", "Interstellar", "Daft Punk"] }];
    const out = balanceByPick(["x1", "x2", "x3", "x4", "y1", "z1"].map((id) => ({ id })), new Map(cands.map((c) => [c.id, c])), folks);
    const gilmore = out.filter((c) => c.id.startsWith("x")).length;
    expect(gilmore).toBeLessThanOrEqual(Math.floor(out.length / 2));
    expect(out.map((c) => c.id)).toEqual(expect.arrayContaining(["y1", "z1", "x1"]));
  });
});

describe("validCuration", () => {
  it("keeps only candidate ids, each once, with a reason that names a real pick", () => {
    const out = validCuration(
      {
        picks: [
          { id: "c0", why: why("Stardew Valley") },
          { id: "made-up", why: why("Something") },
          { id: "c0", why: why("Again") },
          { id: "c1", why: "A lovely film you will both enjoy a lot." },
          { id: "c2", why: why("Joe Hisaishi") },
          { id: "c4", why: why("Anne with an E") },
        ],
      },
      people,
      cands,
    );
    expect(out?.map((p) => p.id)).toEqual(["c0", "c2", "c4"]);
  });

  it("drops what someone dislikes, gendered pronouns and links, and gives up below three", () => {
    const out = validCuration(
      {
        picks: [
          { id: "c3", why: why("Horror Film") },
          { id: "c0", why: "Sam will love it because he plays Minecraft, and Priya likes Fleet Foxes." },
          { id: "c1", why: "Spirited Away fans see www.example.com for Little Women vibes." },
          { id: "c2", why: why("Joe Hisaishi") },
        ],
      },
      people,
      cands,
    );
    expect(out).toBeNull();
  });

  it("matches a pick by the start of its title", () => {
    expect(namesAPick("Like the world of Avatar, with bending", ["Avatar: The Last Airbender"])).toBe(true);
    expect(namesAPick("Nothing in common here", ["Avatar: The Last Airbender"])).toBe(false);
  });

  it("writes a plain fallback reason from Qloo's credits", () => {
    expect(plainWhy([{ name: "Sam", pick: "Minecraft" }, { name: "Priya", pick: "Fleet Foxes" }])).toBe(
      "Sam likes Minecraft and Priya likes Fleet Foxes. Fans of both rate it.",
    );
    expect(plainWhy([{ name: "Sam", pick: "Minecraft" }, { name: "Priya" }])).toBe("Fans of Minecraft rate it highly.");
  });
});

// Five two-signal bridges in films: both people's lists contain them, credited to each person.
const film = (id: string, name: string, aff: number, who: string) => ({
  entity_id: id,
  name,
  types: ["urn:entity:movie"],
  query: { affinity: aff, explainability: { "signal.interests.entities": [{ entity_id: who, score: 0.9 }] } },
});
const FILMS = [
  ["f1", "Howl's Moving Castle", 0.95],
  ["f2", "Coco", 0.9],
  ["f3", "Paddington", 0.85],
  ["f4", "Amelie", 0.8],
  ["f5", "Up", 0.75],
] as const;

function stubQloo() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL | string) => {
      const p = new URL(String(url)).searchParams;
      const sig = p.get("signal.interests.entities") ?? "";
      const who = sig.startsWith("a") ? "a1" : sig.startsWith("b") ? "b1" : "c1";
      const entities = p.get("filter.type") === "urn:entity:movie" ? FILMS.map(([id, n, a]) => film(id, n, a, who)) : [];
      return new Response(JSON.stringify({ results: { entities } }), { status: 200 });
    }),
  );
}

describe("findCommonGround: Larry curates Qloo's candidates", () => {
  beforeEach(() => {
    vi.stubEnv("QLOO_KEY", "test");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
    h.calls = 0;
    stubQloo();
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    const { promises: fs } = await import("node:fs");
    await fs.rm(process.env.ANTHROPIC_SPEND_FILE!, { force: true });
  });

  it("returns the model's choice and order, with its reasons, and only ids Qloo returned", async () => {
    h.reply = JSON.stringify({
      picks: [
        { id: "f3", why: why("Paddington") },
        { id: "not-from-qloo", why: why("Invented") },
        { id: "f1", why: "A moving castle and spirits like Spirited Away, with the warm family story of Little Women." },
        // Qloo found it, but it wasn't offered (at most 4 candidates per domain), so it can't be chosen.
        { id: "f5", why: why("Up") },
        { id: "f4", why: why("Amelie") },
      ],
    });
    const charged: number[] = [];
    const { bridges } = await findCommonGround(A, B, ["movie"], { charge: (usd) => void charged.push(usd) });
    expect(h.calls).toBe(1);
    expect(bridges.map((b) => b.id)).toEqual(["f3", "f1", "f4"]);
    expect(bridges[1].why).toMatch(/moving castle/);
    expect(bridges[0]).toMatchObject({ fromA: ["Minecraft"], fromB: ["Fleet Foxes"] });
    expect(charged).toHaveLength(1);
    expect(charged[0]).toBeGreaterThan(0);
    // The candidates went to the model as data, with Qloo's credits.
    expect(String((h.params!.messages as { content: string }[])[0].content)).toContain("qloo_credits");
  });

  it("falls back to Qloo's ranking with a plain reason when the model fails", async () => {
    h.reply = () => {
      throw new Error("overloaded");
    };
    const { bridges } = await findCommonGround(A, B, ["movie"]);
    expect(bridges.map((b) => b.id).slice(0, 2)).toEqual(["f1", "f2"]);
    expect(bridges[0].why).toBe("Sam likes Minecraft and Priya likes Fleet Foxes. Fans of both rate it.");
  });

  it("falls back when the model returns too little that passes the checks", async () => {
    h.reply = JSON.stringify({ picks: [{ id: "f1", why: why("Howl") }, { id: "zzz", why: why("Nope") }] });
    const { bridges } = await findCommonGround(A, B, ["movie"]);
    expect(bridges[0].why).toMatch(/Fans of both rate it/);
  });

  it("makes no model call with curate: false, or without a key", async () => {
    await findCommonGround(A, B, ["movie"], { curate: false });
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
    await findCommonGround(A, B, ["movie"]);
    expect(h.calls).toBe(0);
  });

  it("curates group common ground too, keyed by member id", async () => {
    const m = (id: string, p: Profile): GroupMember => ({ id, name: p.name, profile: p, color: "var(--film)" });
    const C: Profile = { name: "Jo", items: [{ id: "c1", name: "Celeste", domain: "videogame" }] };
    h.reply = JSON.stringify({
      picks: ["f2", "f4", "f5"].map((id) => ({ id, why: "Bright music like Fleet Foxes, a world to explore like Minecraft, and Celeste's heart." })),
    });
    const g = await findGroupCommonGround([m("m1", A), m("m2", B), m("m3", C)], ["movie"]);
    expect(g.bridges.map((b) => b.id)).toEqual(["f2", "f4", "f5"]);
    expect(g.bridges[0].why).toMatch(/Fleet Foxes/);
  });
});
