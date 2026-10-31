import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Plan Ticket checks, and the agent tools around them. The model is mocked; Qloo is stubbed.
const h = vi.hoisted(() => {
  process.env.ANTHROPIC_SPEND_FILE = `${process.env.TMPDIR ?? "/tmp"}/larry-plan-ticket-test-${process.pid}.json`;
  return {
    params: undefined as undefined | Record<string, unknown>,
    reply: "Here is your plan.",
    beforeYield: undefined as undefined | (() => Promise<void>),
  };
});

vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    beta = {
      messages: {
        toolRunner: (params: Record<string, unknown>) => {
          h.params = params;
          return (async function* () {
            await h.beforeYield?.();
            yield { content: [{ type: "text", text: h.reply }], stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 40 } };
          })();
        },
      },
    };
  }
  return { default: Anthropic };
});

const { composePlanTicket, planBFor, runGroupChat, runPairChat, ticketOrder } = await import("./agent");
const { closedOn, learnedFromCheckIn, nextRungFallback, targetRung, ticketTimes, buildTicket, stepFromTicket } = await import("./suggest-steps");
const { fallbackPlanB, validPlanB, validRung } = await import("./suggest");
import type { PlaceCardPlus } from "./qloo";
import type { GroupMember } from "./contracts";

const card = (id: string, name: string, extra: Partial<PlaceCardPlus> = {}): PlaceCardPlus => ({
  id,
  name,
  tags: ["Board games"],
  affinity: 0.7,
  vibe: "calm",
  slots: ["Sat 11am", "Sun 11am"],
  fits: [{ who: "b", likely: "maybe", why: "Some fans of Fleet Foxes go here." }],
  distanceKm: 0.6,
  ...extra,
});
const condi = card("condi", "Café Condi");
const books = card("books", "Kitab Khana", { vibe: "cosy", slots: [] });
const items = [
  { id: "zelda", name: "The Legend of Zelda: Breath of the Wild", domain: "videogame" as const },
  { id: "mc", name: "Minecraft", domain: "videogame" as const },
];
const whoOf = new Map([
  ["a", "a"],
  ["b", "b"],
]);

describe("composePlanTicket", () => {
  it("builds a ticket only from a real place, one of its daytime slots and a real item", () => {
    const made = composePlanTicket(
      {
        place_id: "condi",
        item: "the legend of zelda: breath of the wild",
        when: "Sun 11am",
        opener: "Have you played Zelda? The board games here remind me of it.",
        fits: [{ who: "a", likely: "likes", why: "Board games, and it's quiet." }],
      },
      { places: [condi, books], items, whoOf },
    );
    if ("error" in made) throw new Error(made.error);
    expect(made.ticket).toMatchObject({
      place: { id: "condi", name: "Café Condi" },
      when: "Sun 11am",
      item: { id: "zelda", domain: "videogame" },
      opener: "Have you played Zelda? The board games here remind me of it.",
      rung: 0,
    });
    // The model judged a; b keeps Qloo's rule-based fit.
    expect(made.ticket.place.fits).toEqual([
      { who: "a", likely: "likes", why: "Board games, and it's quiet." },
      { who: "b", likely: "maybe", why: "Some fans of Fleet Foxes go here." },
    ]);
  });

  it("refuses a place id Qloo didn't return, and an item that isn't in the data", () => {
    expect(composePlanTicket({ place_id: "invented", opener: "Hi" }, { places: [condi], items, whoOf })).toEqual({
      error: "Unknown place_id. Use an id from find_places_nearby.",
    });
    expect(composePlanTicket({ place_id: "condi", item: "Elden Ring", opener: "Hi" }, { places: [condi], items, whoOf })).toMatchObject({
      error: expect.stringContaining("not in the data"),
    });
  });

  it("never invents a time, and replaces an opener that isn't about the item or guesses gender", () => {
    const made = composePlanTicket(
      { place_id: "condi", item: "Minecraft", when: "Fri 11pm", opener: "Ask her about her day.", fits: [{ who: "zz", likely: "likes", why: "x" }] },
      { places: [condi], items, whoOf },
    );
    if ("error" in made) throw new Error(made.error);
    expect(made.ticket.when).toBe("Sat 11am");
    expect(made.ticket.opener).toBe("Have you ever tried Minecraft?");
    expect(made.ticket.place.fits.map((f) => f.who)).toEqual(["b"]);
    // With no place that has hours, a no-hours place is allowed, still with a real day and time
    // (the ticket itself says "check before you go").
    const noHours = composePlanTicket({ place_id: "books", opener: "Seen Minecraft books here?" }, { places: [books], items, whoOf });
    if ("error" in noHours) throw new Error(noHours.error);
    expect(noHours.ticket.when).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2}(am|pm)$/);
  });
});

describe("ticket places and times", () => {
  it("refuses a place with no known hours while others have them, and orders tickets hours-first", () => {
    const refused = composePlanTicket({ place_id: "books", opener: "Seen Minecraft books here?" }, { places: [condi, books], items, whoOf });
    expect(refused).toMatchObject({ error: expect.stringContaining("no known opening hours") });
    expect(ticketOrder([books, card("loud", "Loud Arcade", { vibe: "lively" }), condi]).map((p) => p.id)).toEqual(["condi", "loud", "books"]);
  });

  it("varies the ticket place between different people, but keeps it stable for the same people", () => {
    const many = Array.from({ length: 8 }, (_, i) => card(`p${i}`, `Place ${i}`));
    const firsts = new Set(["a1,b1", "a2,b2", "a3,b3", "a4,b4", "a5,b5", "a6,b6"].map((seed) => ticketOrder(many, seed)[0].id));
    expect(firsts.size).toBeGreaterThan(1);
    expect(ticketOrder(many, "a1,b1")[0].id).toBe(ticketOrder(many, "a1,b1")[0].id);
  });

  it("offers the place's own hours-checked slots as chips, and generic ones only without hours", () => {
    const now = new Date(2026, 9, 26, 12); // a Monday
    const breakfast = { ...buildTicket({ place: card("bk", "Breakfast Club", { hours: "Daily 8am-1pm", slots: ["Tue 10am", "Sat 10am"] }) }), when: "Tue 10am" };
    expect(ticketTimes(breakfast, now)).toEqual({ choices: ["Tue 10am", "Sat 10am"], checkDoor: false });
    // A device-built ticket defaults to the place's own first slot.
    expect(buildTicket({ place: card("bk", "Breakfast Club", { slots: ["Wed 10am"] }), now }).when).toBe("Wed 10am");
    const unknown = buildTicket({ place: card("u", "Unknown Hours", { slots: [] }), now });
    expect(ticketTimes(unknown, now).checkDoor).toBe(true);
  });

  it("reads closed days in ranges as well as single days", () => {
    const hours = "Mon-Wed closed, Thu-Sun 10am-6pm";
    expect([0, 1, 2, 3, 4, 5, 6].map((d) => closedOn(hours, d))).toEqual([false, true, true, true, false, false, false]);
    expect(closedOn("Sunday: Closed", 0)).toBe(true);
    expect(closedOn("Closed Sat–Mon", 0)).toBe(true);
    expect(closedOn("Closed Sat–Mon", 3)).toBe(false);
  });

  it("saves a ticket as a place step, so its vibe rung is read on the place ladder", () => {
    const step = stepFromTicket({ ...buildTicket({ place: card("lv", "Pixel Arcade", { vibe: "lively" }) }), when: "Sat 11am" });
    expect(step).toMatchObject({ kind: "go", placeId: "lv", placeName: "Pixel Arcade", vibe: "lively", rung: 2 });
  });
});

describe("the ladder's next rung", () => {
  const candidates = [
    { id: "lib", name: "Town Library", vibe: "calm" as const, tags: ["Quiet", "Reading"] },
    { id: "cafe", name: "Dice Café", vibe: "cosy" as const, tags: ["Board games"] },
    { id: "arc", name: "Pixel Arcade", vibe: "lively" as const, tags: ["Arcade"] },
  ];
  const step = { text: "Go to Dice Café", placeId: "cafe", placeName: "Dice Café", vibe: "cosy" as const };

  it("the fixed fallback reads the reason: too loud never goes up, couldn't find it stays", () => {
    expect(targetRung(1, "good", "too_loud")).toBe(0);
    expect(targetRung(1, "good", "cant_find")).toBe(1);
    expect(targetRung(1, "hard", "loved")).toBe(1);
    expect(nextRungFallback({ step, feeling: "good", reason: "too_loud", candidates })).toMatchObject({ placeId: "lib", vibe: "calm", move: "back", fallback: true });
    expect(nextRungFallback({ step, feeling: "good", candidates })).toMatchObject({ placeId: "arc", vibe: "lively", move: "up" });
  });

  it("learns from the reason: too loud and loved change the place vibe; logistics teach nothing", () => {
    expect(learnedFromCheckIn("too_loud", "cosy")).toMatchObject({ placeVibe: "calm", addNotes: ["finds loud places hard"] });
    expect(learnedFromCheckIn("loved", "lively")).toMatchObject({ placeVibe: "lively" });
    expect(learnedFromCheckIn("cant_find", "cosy")).toBeUndefined();
  });

  it("only accepts Larry's pick from the real candidates, with a plain line and no routine", () => {
    const input = { step, feeling: "good" as const, reason: "too_loud" as const, candidates };
    expect(validRung({ place_id: "lib", why: "Town Library is quiet and good for reading, after a loud café." }, input)).toEqual({
      placeId: "lib",
      why: "Town Library is quiet and good for reading, after a loud café.",
    });
    expect(validRung({ place_id: "invented", why: "Somewhere quiet and calm for you." }, input)).toBeNull();
    expect(validRung({ place_id: "lib", why: "Town Library on Saturdays at 10am is quiet." }, input)).toBeNull();
    expect(validRung({ place_id: "lib", why: "She would like the Secret Garden Café." }, input)).toBeNull();
  });
});

describe("plan B from Larry", () => {
  const input = { obstacle: "travel" as const, place: { id: "condi", name: "Café Condi", vibe: "calm" as const }, item: { id: "mc", name: "Minecraft" } };
  const nearer = { id: "near", name: "Near Books", distanceKm: 0.4 };

  it("must name the real nearer place for travel, start with If, and invent nothing", () => {
    expect(validPlanB({ plan_b: "If I can't get to Café Condi, I'll go to Near Books instead and bring up Minecraft." }, input, nearer)).toMatch(/^If/);
    expect(validPlanB({ plan_b: "If I can't get there, I'll try another day." }, input, nearer)).toBeNull();
    expect(validPlanB({ plan_b: "If I can't get there, I'll go to Starbucks." }, input)).toBeNull();
    expect(validPlanB({ plan_b: "I'll go anyway." }, input)).toBeNull();
  });

  it("falls back to a real if-then line with the nearer place", () => {
    expect(fallbackPlanB(input, nearer)).toBe("If I can't get to Café Condi, I'll go to Near Books instead, 0.4 km away.");
    expect(fallbackPlanB({ ...input, obstacle: "words" })).toBe("If I don't know what to say, I'll bring up Minecraft.");
  });
});

describe("plan B", () => {
  it("re-asks Qloo nearer for can't-get-there, and offers a calmer place for too-busy", async () => {
    const nearer = vi.fn(async () => [card("near", "Near Books", { distanceKm: 0.4 })]);
    expect(await planBFor("cant_get_there", condi, [condi, books], nearer)).toBe("If you can't get to Café Condi, Near Books is closer (0.4 km).");
    expect(nearer).toHaveBeenCalledOnce();
    expect(await planBFor("too_busy", condi, [condi, books], nearer)).toBe("If it's too busy, go to Kitab Khana instead (0.6 km).");
    expect(await planBFor("nervous", condi, [condi], nearer)).toMatch(/10 minutes/);
  });

  it("leaves the asker's distances out when the plan is shown to a group", async () => {
    const nearer = vi.fn(async () => [card("near", "Near Books", { distanceKm: 0.4 })]);
    expect(await planBFor("cant_get_there", condi, [condi, books], nearer, { distances: false })).toBe("If you can't get to Café Condi, Near Books is closer.");
    expect(await planBFor("too_busy", condi, [condi, books], nearer, { distances: false })).toBe("If it's too busy, go to Kitab Khana instead.");
  });
});

// ---------------------------------------------------------------- the tools inside a run

const placeEntity = (id: string, name: string) => ({
  entity_id: id,
  name,
  types: ["urn:entity:place"],
  tags: [{ id: "urn:tag:category:place:board_game_club", name: "Board game club" }, { id: "urn:tag:noise_level:qloo:quiet", name: "Quiet" }],
  location: { lat: 19.06, lon: 72.83 },
  properties: {
    hours: Object.fromEntries(
      ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => [d, [{ opens: "T10:00:00", closes: "T22:00:00" }]]),
    ),
  },
  query: { affinity: 0.8, explainability: { "signal.interests.entities": [{ entity_id: "a1", score: 1 }] } },
});

type Tool = { name: string; run: (args: unknown) => Promise<string> };
const tool = (name: string) => (h.params!.tools as Tool[]).find((t) => t.name === name)!;

describe("make_plan_ticket in a run", () => {
  const radii: number[] = [];
  beforeEach(() => {
    radii.length = 0;
    h.params = undefined;
    h.beforeYield = undefined;
    vi.stubEnv("QLOO_KEY", "test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | string) => {
        const p = new URL(String(url)).searchParams;
        const r = Number(p.get("filter.location.radius"));
        if (r) radii.push(r);
        const tags = p.get("filter.tags") ?? "";
        let entities: unknown[] = [];
        if (p.get("filter.type") === "urn:entity:place" && tags.includes("board_game_club")) {
          entities = r === 1000 ? [placeEntity("near", "Dice Corner")] : [placeEntity("condi", "Café Condi"), placeEntity("near", "Dice Corner")];
        }
        return new Response(JSON.stringify({ results: { entities } }), { status: 200 });
      }),
    );
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    const { promises: fs } = await import("node:fs");
    await fs.rm(process.env.ANTHROPIC_SPEND_FILE!, { force: true });
  });

  const sam = { name: "Sam", items: [{ id: "a1", name: "Minecraft", domain: "videogame" as const }] };
  const priya = { name: "Priya", items: [{ id: "b1", name: "Fleet Foxes", domain: "artist" as const }] };

  it("pair: finds places, then saves a ticket with a nearer plan B, and a First Step for old clients", async () => {
    const outs: string[] = [];
    h.beforeYield = async () => {
      outs.push(await tool("find_places_nearby").run({}));
      outs.push(await tool("make_plan_ticket").run({ place_id: "condi", item: "Minecraft", opener: "Want to build in Minecraft after this?", obstacle: "cant_get_there" }));
    };
    const r = await runPairChat({ a: sam, b: priya, history: [{ role: "user", content: "[Sam] let's go somewhere" }], location: { lat: 19.06, lon: 72.83 } });
    const found = JSON.parse(outs[0]) as { id: string; vibe: string; slots: string[] }[];
    expect(found.map((p) => p.id).sort()).toEqual(["condi", "near"]);
    expect(found[0]).toMatchObject({ vibe: "calm" });
    expect(r.planTicket).toMatchObject({ place: { id: "condi" }, item: { id: "a1" }, planB: "If you can't get to Café Condi, Dice Corner is closer (0 km)." });
    expect(r.planTicket!.when).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d/);
    expect(radii).toContain(1000);
    expect(r.steps[0]).toMatchObject({ kind: "go", text: expect.stringContaining("Café Condi") });
  });

  it("refuses an invented place id even after asking Qloo again", async () => {
    let out = "";
    h.beforeYield = async () => {
      out = await tool("make_plan_ticket").run({ place_id: "made-up", opener: "Hi there friend" });
    };
    const r = await runPairChat({ a: sam, b: priya, history: [{ role: "user", content: "[Sam] plan?" }], location: { lat: 19.06, lon: 72.83 } });
    expect(out).toMatch(/^Not saved: Unknown place_id/);
    expect(r.planTicket).toBeUndefined();
  });

  it("group: no one gets the asker's distances (not the model, the places, the ticket or plan B)", async () => {
    const outs: string[] = [];
    h.beforeYield = async () => {
      outs.push(await tool("find_places_nearby").run({}));
      outs.push(await tool("make_plan_ticket").run({ place_id: "condi", item: "Minecraft", opener: "Want to build in Minecraft after this?", obstacle: "cant_get_there" }));
    };
    const members: GroupMember[] = [
      { id: "m1", name: "Sam", color: "var(--film)", profile: sam },
      { id: "m2", name: "Priya", color: "var(--music)", profile: priya },
    ];
    const r = await runGroupChat({ mode: "group", members, history: [{ role: "user", content: "[Sam] let's go somewhere" }], location: { lat: 19.06, lon: 72.83 } });
    expect(outs[0]).not.toContain("km");
    expect(r.places?.length).toBeGreaterThan(0);
    for (const p of r.places ?? []) expect(p).not.toHaveProperty("distanceKm");
    expect(r.planTicket?.place).not.toHaveProperty("distanceKm");
    expect(r.planTicket?.planB).toBe("If you can't get to Café Condi, Dice Corner is closer.");
  });

  it("solo talk taste ends at a Plan Ticket even when the model didn't make one", async () => {
    const turns = Array.from({ length: 8 }, (_, i) => [
      { role: "user" as const, content: `message ${i}` },
      { role: "assistant" as const, content: "ok" },
    ]).flat();
    const me: GroupMember = { id: "me", name: "Sam", color: "var(--film)", profile: sam };
    const r = await runGroupChat({ mode: "solo", members: [me], history: turns, location: { lat: 19.06, lon: 72.83 } });
    expect(r.wrapUp).toBe(true);
    expect(r.planTicket).toMatchObject({ place: { id: r.places![0].id }, item: { name: "Minecraft" } });
    expect(r.steps[0]).toMatchObject({ kind: "go" });
  });
});

// ---------------------------------------------------------------- the if-then line and the six worries (1A)

describe("ifThenLine", async () => {
  const { ifThenLine, ifThenSpoken, OBSTACLES, planBFor: ticketPlanB, guessAllowed, isoWeekId, isTemplateOpener, withExtras, ticketTimes, goodFit } = await import("./suggest-steps");
  const place = { id: "C1", name: "Café Condi", tags: ["Board games"], affinity: 0.9, fits: [], vibe: "cosy" as const };
  const ticket = { place, when: "Sat 3pm", opener: "Have you played Cascadia?", item: { id: "i1", name: "Cascadia", domain: "videogame" as const } };

  it("reads as one line the person can repeat", () => {
    expect(ifThenLine(ticket, "Sat 3pm", ticket.opener)).toBe(`If it's Sat 3pm, then I walk to Café Condi and say: "Have you played Cascadia?"`);
    expect(ifThenLine(ticket, "Any afternoon", "")).toBe("If it's an afternoon this week, then I walk to Café Condi.");
    expect(ifThenLine(ticket, "Sun 11am", "'Hi'")).toBe(`If it's Sun 11am, then I walk to Café Condi and say: "Hi."`);
  });

  it("is gentler and shorter on a low-energy day", () => {
    expect(ifThenLine(ticket, "Sat 3pm", ticket.opener, { mood: "low-energy" })).toBe(`If it's Sat 3pm, I pop into Café Condi for 10 minutes and say: "Have you played Cascadia?"`);
  });

  it("spells days and times out for screen readers", () => {
    expect(ifThenSpoken(ifThenLine(ticket, "Sat 3pm", ticket.opener))).toBe("If it's Saturday 3 p.m., then I walk to Café Condi and say: Have you played Cascadia?");
  });

  it("has six worries, each with an if-then plan B from the real place and item", () => {
    expect(OBSTACLES.map((o) => o.id)).toEqual(["nervous", "words", "alone", "travel", "loud", "leave"]);
    for (const o of OBSTACLES) expect(ticketPlanB(o.id, ticket)).toMatch(/^If /);
    expect(ticketPlanB("words", ticket)).toContain("Cascadia");
    expect(ticketPlanB("loud", ticket)).toContain("Café Condi");
    expect(ticketPlanB("leave", ticket)).toContain("That still counts.");
  });

  it("asks for a guess at most once a week", () => {
    const now = new Date("2026-10-30T12:00:00");
    expect(isoWeekId(now)).toBe("2026-W44");
    expect(guessAllowed(null, now)).toBe(true);
    expect(guessAllowed("2026-W44", now)).toBe(false);
    expect(guessAllowed("2026-W43", now)).toBe(true);
  });

  it("only replaces template openers, and Amazon hours only fill gaps", () => {
    expect(isTemplateOpener("Have you ever tried Cascadia?")).toBe(true);
    expect(isTemplateOpener("Which Cascadia habitat do you always build first?")).toBe(false);
    const filled = withExtras({ ...ticket, opener: "Have you tried Cascadia?" }, { hours: "Daily 10am-7pm", slots: ["Sat 11am"], opener: "Fox or salmon in Cascadia?", fallback: false });
    expect(filled.place.hours).toBe("Daily 10am-7pm");
    expect(filled.opener).toBe("Fox or salmon in Cascadia?");
    expect(ticketTimes(filled, new Date("2026-10-30T12:00:00"))).toEqual({ choices: ["Sat 11am"], checkDoor: false });
    const kept = withExtras({ ...ticket, place: { ...place, hours: "Daily 8am-9pm" } }, { hours: "Daily 10am-7pm", opener: "Fox or salmon in Cascadia?", fallback: false });
    expect(kept.place.hours).toBe("Daily 8am-9pm");
    expect(kept.opener).toBe(ticket.opener);
  });

  it("with no hours at all, still offers a concrete day and time and says to check first", () => {
    const { choices, checkDoor } = ticketTimes({ ...ticket, when: "Any afternoon (check the door first)" }, new Date("2026-10-30T12:00:00"));
    expect(checkDoor).toBe(true);
    expect(choices[0]).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2}(am|pm)$/);
  });

  it("goodFit drops places judged not-for-them", () => {
    expect(goodFit({ fits: [{ who: "a", likely: "maybe", why: "x" }] })).toBe(true);
    expect(goodFit({ fits: [{ who: "a", likely: "not-for-them", why: "x" }] })).toBe(false);
  });
});
