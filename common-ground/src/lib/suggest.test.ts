import { promises as fs } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The model is mocked: no real Anthropic call is made. The spend file is a temp file.
const h = vi.hoisted(() => {
  process.env.ANTHROPIC_SPEND_FILE = `${process.env.TMPDIR ?? "/tmp"}/larry-suggest-test-${process.pid}.json`;
  return { params: undefined as undefined | Record<string, unknown>, calls: 0, text: "", fail: false };
});

vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    beta = {
      messages: {
        create: async (params: Record<string, unknown>) => {
          h.params = params;
          h.calls++;
          if (h.fail) throw new Error("boom");
          return { content: [{ type: "text", text: h.text }], stop_reason: "end_turn", usage: { input_tokens: 500, output_tokens: 80 } };
        },
      },
    };
  }
  return { default: Anthropic };
});

// Amazon Location is mocked too (its own tests cover the HTTP shapes).
const loc = vi.hoisted(() => ({
  enrich: {} as Record<string, unknown>,
  walk: null as number | null,
  legs: [6] as (number | null)[],
}));
vi.mock("./aws/location", () => ({
  enrichPlace: async (place: { hours?: string }) => (place.hours ? { ...loc.enrich, hours: undefined, slots: undefined } : loc.enrich),
  walkMinutes: async () => loc.walk,
  orderStops: async <T,>(stops: T[], o: { first?: number } = {}) => {
    const first = o.first ?? 0;
    const ordered = [stops[first], ...stops.filter((_, i) => i !== first)];
    return { stops: ordered, walks: loc.legs.slice(0, ordered.length - 1) };
  },
}));

const { suggest, fallbackSuggestions, mentionsOnly, validNudges, ticketExtras, fallbackPlanB, validRouteLine, kindOf, pickSecondStop } = await import("./suggest");
import type { SuggestInput } from "./contracts";

const input: SuggestInput = {
  names: ["Sam", "Priya"],
  picks: ["Minecraft", "Spirited Away"],
  bridges: ["Stardew Valley"],
  places: [{ name: "Dice and Tea", kind: "board-game café" }],
  kind: "steps",
};

beforeEach(() => {
  h.params = undefined;
  h.calls = 0;
  h.fail = false;
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(process.env.ANTHROPIC_SPEND_FILE!, { force: true });
});

describe("suggest: steps", () => {
  it("uses the model's three steps when they pass every check, easiest first", async () => {
    h.text = JSON.stringify({
      steps: [
        { kind: "go", text: "Spend ten minutes at Dice and Tea" },
        { kind: "say", text: "Ask Priya what they think of Spirited Away" },
        { kind: "show", text: "Play a round of Stardew Valley together" },
      ],
    });
    const r = await suggest(input);
    expect(r.fallback).toBe(false);
    expect(r.steps.map((s) => s.kind)).toEqual(["say", "show", "go"]);
    expect(h.params).toMatchObject({ model: "claude-opus-5-5", output_config: { effort: "low" } });
    expect(h.params!.max_tokens).toBeLessThanOrEqual(1024);
  });

  it("falls back when a step names something that isn't in the data", async () => {
    h.text = JSON.stringify({
      steps: [
        { kind: "say", text: "Ask Priya about Spirited Away" },
        { kind: "show", text: "Watch Howl's Moving Castle together" },
        { kind: "go", text: "Spend ten minutes at Dice and Tea" },
      ],
    });
    const r = await suggest(input);
    expect(r.fallback).toBe(true);
    expect(r.steps).toHaveLength(3);
  });

  it("falls back on bad JSON, model errors, a missing key, or a used-up budget", async () => {
    h.text = "not json";
    expect((await suggest(input)).fallback).toBe(true);
    h.fail = true;
    expect((await suggest(input)).fallback).toBe(true);
    h.fail = false;

    const before = h.calls;
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
    expect((await suggest(input)).fallback).toBe(true);
    expect(h.calls).toBe(before);

    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    await fs.writeFile(process.env.ANTHROPIC_SPEND_FILE!, JSON.stringify({ usd: 1e9 }));
    expect((await suggest(input)).fallback).toBe(true);
    expect(h.calls).toBe(before);
  });

  it("rejects steps that guess someone's gender", async () => {
    h.text = JSON.stringify({
      steps: [
        { kind: "say", text: "Ask Priya what she thinks of Spirited Away" },
        { kind: "show", text: "Play a round of Stardew Valley together" },
        { kind: "go", text: "Spend ten minutes at Dice and Tea" },
      ],
    });
    expect((await suggest(input)).fallback).toBe(true);
  });

  it("rejects repeated openings and go steps with no places", async () => {
    h.text = JSON.stringify({
      steps: [
        { kind: "say", text: "Ask someone about Minecraft" },
        { kind: "say", text: "Ask someone about Spirited Away" },
        { kind: "go", text: "Go for a walk somewhere nice" },
      ],
    });
    expect((await suggest({ ...input, places: [] })).fallback).toBe(true);
  });
});

describe("suggest: nudges", () => {
  it("keeps nudges of at most five words with no names or questions", async () => {
    h.text = JSON.stringify({ nudges: ["Small hellos count.", "You are doing really well today friend.", "Ask Sam more", "Why not try?", "Easy does it.", "One word is fine.", "Breathe, then type."] });
    const r = await suggest({ ...input, kind: "nudges" });
    expect(r).toEqual({ steps: [], nudges: ["Small hellos count.", "Easy does it.", "One word is fine.", "Breathe, then type."], fallback: false });
  });

  it("falls back when fewer than four survive", () => {
    expect(validNudges(["Hi.", "This one is far too long to count"], { ...input, kind: "nudges" })).toBeNull();
  });
});

describe("fallbackSuggestions", () => {
  it("writes varied steps that mention only the given items", () => {
    const seen = new Set<string>();
    for (const r of [0, 0.4, 0.9]) {
      const res = fallbackSuggestions(input, () => r);
      expect(res.fallback).toBe(true);
      expect(res.steps.map((s) => s.kind)).toEqual(["say", "show", "go"]);
      for (const s of res.steps) {
        expect(mentionsOnly(s.text, ["Sam", "Priya", "Minecraft", "Spirited Away", "Stardew Valley", "Dice and Tea"])).toBe(true);
        seen.add(s.text);
      }
    }
    expect(seen.size).toBeGreaterThan(3);
    expect(fallbackSuggestions(input, () => 0).steps[0].text).toBe("Find someone who also likes Minecraft");
  });

  it("never tells the reader to do something with themselves, and says 'the group' for several others", () => {
    for (let i = 0; i < 20; i++) {
      const v = i / 20;
      const group = fallbackSuggestions({ ...input, names: ["Ben", "Ana", "Priya"] }, () => v);
      for (const s of group.steps) expect(s.text).not.toMatch(/\b(Ben|Ana|Priya)\b/);
      const pair = fallbackSuggestions({ ...input, names: ["Ben", "Ana"] }, () => v);
      for (const s of pair.steps) expect(s.text).not.toMatch(/\bBen\b/);
    }
    expect(fallbackSuggestions({ ...input, names: ["Ben", "Ana", "Priya"] }, () => 0).steps[1].text).toBe("Try Stardew Valley with the group");
  });

  it("rejects model steps that name the reader", async () => {
    h.text = JSON.stringify({
      steps: [
        { kind: "say", text: "Ask Sam what they think of Spirited Away" },
        { kind: "show", text: "Play a round of Stardew Valley together" },
        { kind: "go", text: "Spend ten minutes at Dice and Tea" },
      ],
    });
    const r = await suggest(input);
    expect(r.fallback).toBe(true);
  });

  it("still gives three steps with no data at all", () => {
    const r = fallbackSuggestions({ names: [], picks: [], bridges: [], places: [], kind: "steps" }, () => 0);
    expect(r.steps).toHaveLength(3);
    expect(new Set(r.steps.map((s) => s.text)).size).toBe(3);
  });

  it("gives five short nudges", () => {
    const r = fallbackSuggestions({ ...input, kind: "nudges" });
    expect(r.nudges).toHaveLength(5);
    for (const n of r.nudges) expect(n.split(" ").length).toBeLessThanOrEqual(5);
  });
});

describe("mentionsOnly", () => {
  it("allows given names, sentence starts and common words", () => {
    expect(mentionsOnly("Ask Priya about Spirited Away on Friday", ["Priya", "Spirited Away"])).toBe(true);
    expect(mentionsOnly("Watch Totoro with Priya", ["Priya"])).toBe(false);
    expect(mentionsOnly("Tell them I like it", [])).toBe(true);
  });
});

// ---------------------------------------------------------------- the ticket

describe("suggest: mood", () => {
  it("sends the person's mood to the model with the data", async () => {
    h.text = JSON.stringify({ steps: [] });
    await suggest(input, { mood: "low-energy" });
    const content = (h.params?.messages as { content: string }[])[0].content;
    expect(content).toContain('"mood":"low-energy"');
  });
});

describe("plan B: the two new worries", () => {
  const ask = { place: { id: "p1", name: "Café Condi", vibe: "cosy" as const }, item: { id: "i1", name: "Cascadia" } };
  it("'I'll want to leave' gives a kind exit line, 'too loud' names a calmer place when there is one", () => {
    expect(fallbackPlanB({ ...ask, obstacle: "leave" })).toBe(`If I want to leave, I'll say "I've got to head off" and go. That still counts.`);
    expect(fallbackPlanB({ ...ask, obstacle: "loud" }, { id: "p2", name: "Kitab Khana" })).toContain("Kitab Khana");
    expect(fallbackPlanB({ ...ask, obstacle: "loud" })).toMatch(/^If Café Condi is too loud/);
  });
});

describe("ticketExtras", () => {
  const cafe = { id: "C1", name: "Café Condi", vibe: "cosy" as const, reason: "A café. Easy to sit and talk.", tags: ["Board games"] };
  const books = {
    id: "B1",
    name: "Kitab Khana",
    vibe: "calm" as const,
    reason: "A bookshop. Easy to browse together.",
    tags: [],
    affinity: 0.8,
    fits: [],
    distanceKm: 0.3,
  };
  const pins: Record<string, { lat: number; lon: number }> = { C1: { lat: 19.06, lon: 72.83 }, B1: { lat: 19.062, lon: 72.831 } };
  const deps = (near: unknown[] = [books]) => ({
    pinOf: async (id: string) => pins[id] ?? null,
    near: async () => near as never,
    now: new Date("2026-10-30T10:00:00+05:30"),
  });
  beforeEach(() => {
    loc.enrich = {};
    loc.walk = null;
    loc.legs = [6];
  });

  it("fills missing hours from Amazon, the walking time, and a second stop in café-then-bookshop order", async () => {
    loc.enrich = { hours: "Daily 10:30am-7:30pm", slots: ["Sat 11am", "Sun 2pm"], openNow: false };
    loc.walk = 12;
    h.text = JSON.stringify({ opener: "", route: "Tea at Café Condi first, then a 6 minute stroll to Kitab Khana, then a slow walk." });
    const out = await ticketExtras({ place: cafe, item: { id: "i1", name: "Cascadia" }, opener: "Have you ever played Cascadia before today?", start: { lat: 19.05, lon: 72.82 } }, { charge: () => {}, deps: deps() });
    expect(out).toMatchObject({ hours: "Daily 10:30am-7:30pm", hoursFrom: "amazon", slots: ["Sat 11am", "Sun 2pm"], openNow: false, walkMin: 12 });
    expect(out.route?.stops.map((s) => s.name)).toEqual(["Café Condi", "Kitab Khana"]);
    expect(out.route?.walks).toEqual([6]);
    expect(out.route?.fromLarry).toBe(true);
    expect(out.fallback).toBe(false);
    // The ticket's own (non-template) opener is kept: Larry only replaces templates.
    expect(out.opener).toBeUndefined();
  });

  it("writes a fresh opener when the ticket only had a template, and checks it names the item", async () => {
    h.text = JSON.stringify({ opener: "Which Cascadia habitat do you always end up building?", route: "" });
    const out = await ticketExtras({ place: cafe, item: { id: "i1", name: "Cascadia" }, opener: "Have you ever tried Cascadia?" }, { charge: () => {}, deps: deps([]) });
    expect(out.opener).toBe("Which Cascadia habitat do you always end up building?");
    h.text = JSON.stringify({ opener: "Do you like Catan?", route: "" });
    const bad = await ticketExtras({ place: cafe, item: { id: "i1", name: "Cascadia" }, opener: "Have you ever tried Cascadia?" }, { charge: () => {}, deps: deps([]) });
    expect(bad.opener).toBeUndefined();
    expect(bad.fallback).toBe(true);
  });

  it("without a code: no model call, Amazon and Qloo still fill in, and the route line is the fixed one", async () => {
    loc.walk = 55; // too far to call a walk
    const out = await ticketExtras({ place: { ...cafe, hours: "Daily 9am-9pm" }, item: { id: "i1", name: "Cascadia" } }, { charge: null, deps: deps() });
    expect(h.calls).toBe(0);
    expect(out.hoursFrom).toBe("qloo");
    expect(out.hours).toBeUndefined();
    expect(out.walkMin).toBeUndefined();
    expect(out.route?.line).toBe("First Café Condi. Then a 6 min walk to Kitab Khana. Then a slow walk, no rush.");
    expect(out.route?.fromLarry).toBe(false);
  });

  it("never adds a second stop on a low-energy day, a poor fit, the same kind of place, or a livelier one", async () => {
    const low = await ticketExtras({ place: cafe, item: { id: "i1", name: "Cascadia" }, signals: { mood: "low-energy" } }, { charge: null, deps: deps() });
    expect(low.route).toBeUndefined();
    expect(pickSecondStop(cafe, [{ ...books, fits: [{ who: "a", likely: "not-for-them", why: "too quiet" }] }])).toBeNull();
    expect(pickSecondStop(cafe, [{ ...books, id: "C2", reason: "A café. Easy to sit and talk." }])).toBeNull();
    expect(pickSecondStop({ ...cafe, vibe: "calm" }, [{ ...books, vibe: "lively" }])).toBeNull();
    expect(pickSecondStop(cafe, [books])?.id).toBe("B1");
  });

  it("checks Larry's route line: every stop, in order, and no made-up names", () => {
    const stops = [
      { id: "C1", name: "Café Condi" },
      { id: "B1", name: "Kitab Khana" },
    ];
    expect(validRouteLine("Start at Café Condi, then walk to Kitab Khana.", stops)).toBeTruthy();
    expect(validRouteLine("Start at Kitab Khana, then Café Condi.", stops)).toBeNull();
    expect(validRouteLine("Start at Café Condi, then Kitab Khana, then Marine Drive.", stops)).toBeNull();
    expect(kindOf("A bookshop. Easy to browse together.")).toBe("a bookshop");
  });

  it("still answers when Qloo has no pin (nothing to add)", async () => {
    const out = await ticketExtras({ place: { ...cafe, id: "NOPIN" } }, { charge: () => {}, deps: deps() });
    expect(out).toEqual({ fallback: true });
  });
});
