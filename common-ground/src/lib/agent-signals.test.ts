import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mood, age range and Hidden Gems in the agent (1C), and the multi-stop, real-time Plan Ticket.
// The model is mocked (the prompt it would get is captured); Qloo is stubbed. No real calls.
const h = vi.hoisted(() => {
  process.env.ANTHROPIC_SPEND_FILE = `${process.env.TMPDIR ?? "/tmp"}/larry-agent-signals-test-${process.pid}.json`;
  return { params: [] as Record<string, unknown>[], reply: "Here is a thought." };
});

vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    beta = {
      messages: {
        toolRunner: (params: Record<string, unknown>) => {
          h.params.push(params);
          return (async function* () {
            yield { content: [{ type: "text", text: h.reply }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 20 } };
          })();
        },
      },
    };
  }
  return { default: Anthropic };
});

const { composePlanTicket, moodBlend, noHoursWhen, runGroupChat, runPairChat, scrubPrivate, signalsContext, ticketOrder } = await import("./agent");
import type { PlaceCardPlus } from "./qloo";
import type { GroupMember } from "./contracts";
import type { Profile } from "./types";

/** Everything the model would read in one run: system, context and messages. */
const systemOf = (p: Record<string, unknown>) =>
  typeof p.system === "string" ? p.system : (p.system as { text: string }[]).map((b) => b.text).join("\n");
const promptOf = (p: Record<string, unknown>) => systemOf(p) + JSON.stringify(p.messages);

beforeEach(() => {
  h.params = [];
  h.reply = "Here is a thought.";
  vi.stubEnv("ANTHROPIC_API_KEY", "test");
  vi.stubEnv("QLOO_KEY", "test");
  // Qloo answers nothing (the runs here don't need data); no network.
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ results: { entities: [] } }), { status: 200 })));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("moodBlend: rooms blend moods in counts", () => {
  it("leans calm when most feel chill, and says why in counts", () => {
    expect(moodBlend(["chill", "chill", "hype"])).toEqual({ vibes: ["calm", "cosy", "lively"], line: "Two of you feel chill, so somewhere calm." });
    expect(moodBlend(["hype", "social", "social"]).vibes?.[0]).toBe("lively");
    expect(moodBlend(["chill", "hype"]).vibes?.[0]).toBe("cosy");
  });

  it("never names a mood only one person has, so nobody's own mood can be picked out", () => {
    expect(moodBlend(["low-energy", "hype"]).line).toBeUndefined();
    expect(moodBlend(["low-energy"]).line).toBeUndefined();
    expect(moodBlend([]).line).toBeUndefined();
    expect(moodBlend(["curious", "curious", "curious"]).line).toBe("All three of you feel curious, so somewhere with something new to find.");
  });
});

describe("private signals in Larry's words", () => {
  it("gives the model mood and age as private data with the rules, and nothing when unset", () => {
    const text = signalsContext({ mood: "low-energy", ageBucket: "18-24" }, "Sam");
    expect(text).toContain('"mood":"low-energy"');
    expect(text).toContain('"age_range":"18-24"');
    expect(text).toMatch(/Never say the mood or the age range back/);
    expect(signalsContext({ hiddenGems: true }, "Sam")).toBe("");
    expect(signalsContext(undefined, "Sam")).toBe("");
  });

  it("drops any sentence about age, and in a group any sentence tying a name to a mood", () => {
    expect(scrubPrivate("Since you're 18-24, try this café. It has board games.")).toBe("It has board games.");
    expect(scrubPrivate("At your age, arcades rock. Try Dice Café.")).toBe("Try Dice Café.");
    expect(scrubPrivate("Sam feels low on energy today. A quiet café, then?", ["Sam", "Priya"])).toBe("A quiet café, then?");
    // The counts-only room line has no names, so it stays; so do plain words.
    expect(scrubPrivate("Two of you feel chill, so somewhere calm.", ["Sam", "Priya"])).toBe("Two of you feel chill, so somewhere calm.");
    expect(scrubPrivate("Teen Titans or Coco, Sam?", ["Sam"])).toBe("Teen Titans or Coco, Sam?");
  });

  it("pair chat: the owner's signals reach the model as private data, and an age slip is scrubbed", async () => {
    h.reply = "You're 18-24, so here's a pick. Have you played Stardew Valley?";
    const a: Profile = { name: "Sam", items: [{ id: "a1", name: "Minecraft", domain: "videogame" }] };
    const b: Profile = { name: "Priya", items: [{ id: "b1", name: "Coco", domain: "movie" }] };
    const r = await runPairChat({ a, b, history: [{ role: "user", content: "hi" }], signals: { mood: "chill", ageBucket: "18-24" } });
    expect(systemOf(h.params[0])).toContain('"mood":"chill"');
    expect(r.messages.map((m) => m.text).join(" ")).toBe("Have you played Stardew Valley?");
  });

  const members: GroupMember[] = [
    { id: "m1", name: "Sam", color: "var(--seat-1)", profile: { name: "Sam", items: [{ id: "a1", name: "Minecraft", domain: "videogame" }] } },
    { id: "m2", name: "Priya", color: "var(--seat-2)", profile: { name: "Priya", items: [{ id: "b1", name: "Coco", domain: "movie" }] } },
  ];

  it("room: Larry gets the counts-only blend, and never anyone's age", async () => {
    await runGroupChat({
      mode: "group",
      members,
      history: [{ role: "user", content: "[Sam] where should we go?" }],
      roomMoods: ["chill", "chill"],
      signals: { hiddenGems: true, ageBucket: "13-17", mood: "hype" },
    });
    const prompt = promptOf(h.params[0]);
    expect(prompt).toContain("Two of you feel chill, so somewhere calm.");
    expect(prompt).not.toContain("13-17");
    expect(prompt).not.toContain("age_range");
    expect(prompt).not.toContain('"mood"');
  });

  it("Open to meet: no mood and no age at all, whatever is sent", async () => {
    await runGroupChat({
      mode: "group",
      members,
      history: [{ role: "user", content: "[Sam] hi!" }],
      meet: { venueName: "Café Condi" },
      roomMoods: ["chill", "chill"],
      signals: { mood: "hype", ageBucket: "25-34", hiddenGems: true },
    });
    const prompt = promptOf(h.params[0]);
    for (const word of ["chill", "hype", "25-34", "age_range", "room_mood", "PRIVATE SIGNALS"]) expect(prompt).not.toContain(word);
  });

  it("solo: the person's own mood and age shape Larry's tone as private data", async () => {
    const me: GroupMember = { id: "me", name: "Sam", color: "var(--seat-1)", profile: members[0].profile };
    await runGroupChat({ mode: "solo", members: [me], history: [{ role: "user", content: "hi" }], signals: { mood: "low-energy", ageBucket: "35-44" } });
    const system = systemOf(h.params[0]);
    expect(system).toContain('"mood":"low-energy"');
    expect(system).toContain('"age_range":"35-44"');
  });
});

describe("Plan Ticket: real times, a second stop, fresh places", () => {
  const card = (id: string, name: string, extra: Partial<PlaceCardPlus> = {}): PlaceCardPlus => ({
    id,
    name,
    tags: ["Board games"],
    affinity: 0.7,
    vibe: "calm",
    slots: ["Sat 11am"],
    fits: [],
    at: { lat: 19.06, lon: 72.83 },
    ...extra,
  });
  const items = [{ id: "mc", name: "Minecraft", domain: "videogame" as const }];
  const whoOf = new Map([["a", "a"]]);

  it("gives a real day and time even when Qloo has no hours", () => {
    expect(noHoursWhen(new Date(2026, 9, 29, 12))).toBe("Sat 11am"); // Thursday
    expect(noHoursWhen(new Date(2026, 9, 26, 12))).toBe("Tue 5pm"); // Monday: the weekend is far off
    const made = composePlanTicket({ place_id: "x", opener: "Seen Minecraft here?" }, { places: [card("x", "No Hours", { slots: [] })], items, whoOf, now: new Date(2026, 9, 29, 12) });
    if ("error" in made) throw new Error(made.error);
    expect(made.ticket.when).toBe("Sat 11am");
  });

  it("adds a second stop in order, a short walk on, and refuses the same venue twice", () => {
    const first = card("dice", "Dice Café");
    const books = card("tw", "Title Waves", { tags: ["Books"], at: { lat: 19.064, lon: 72.833 } });
    const far = card("far", "Far Books", { at: { lat: 19.2, lon: 72.9 } });
    const twin = card("dice2", "Dice Cafe, Bandra");
    const ctx = { places: [first, books, far, twin], items, whoOf };
    const made = composePlanTicket({ place_id: "dice", opener: "Played Minecraft?", then_place_id: "tw", then_todo: "Browse the Minecraft guides together." }, ctx);
    if ("error" in made) throw new Error(made.error);
    expect(made.ticket.then).toMatchObject({ place: { id: "tw" }, todo: "Browse the Minecraft guides together." });
    expect(made.ticket.then!.walkMin).toBeGreaterThanOrEqual(2);
    expect(made.ticket.then!.walkMin).toBeLessThan(15);
    expect(composePlanTicket({ place_id: "dice", opener: "Played Minecraft?", then_place_id: "far" }, ctx)).toMatchObject({ error: expect.stringContaining("too far") });
    expect(composePlanTicket({ place_id: "dice", opener: "Played Minecraft?", then_place_id: "dice2" }, ctx)).toMatchObject({ error: expect.stringContaining("different place") });
  });

  it("puts places shown lately after fresh ones with the same hours standing", () => {
    const list = [card("old", "Old Favourite"), card("new", "New Spot"), card("nohours", "No Hours", { slots: [] })];
    expect(ticketOrder(list, undefined, new Set(["old"])).map((p) => p.id)).toEqual(["new", "old", "nohours"]);
  });

  it("never picks a poor fit while a good one is left", () => {
    const poor = card("poor", "Devotional Books", { fits: [{ who: "a", likely: "not-for-them", why: "not their kind of shop" }] });
    const good = card("good", "Dice Cafe", { slots: [] });
    // Poor fit goes after everything, even a place with no known hours.
    expect(ticketOrder([poor, good]).map((p) => p.id)).toEqual(["good", "poor"]);
    const ctx = { places: [poor, good], items, whoOf };
    expect(composePlanTicket({ place_id: "poor", opener: "Played Minecraft?" }, ctx)).toMatchObject({ error: expect.stringContaining("not for one of them") });
    expect(composePlanTicket({ place_id: "good", opener: "Played Minecraft?", then_place_id: "poor" }, ctx)).toMatchObject({
      error: expect.stringContaining("not for one of them"),
    });
    // Only poor fits left: still a plan, never an empty ticket.
    expect("ticket" in composePlanTicket({ place_id: "poor", opener: "Played Minecraft?" }, { places: [poor], items, whoOf })).toBe(true);
  });
});
