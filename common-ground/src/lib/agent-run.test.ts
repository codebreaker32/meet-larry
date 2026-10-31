import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The model is mocked: no real Anthropic call is made. The spend file is a temp file.
const h = vi.hoisted(() => {
  process.env.ANTHROPIC_SPEND_FILE = `${process.env.TMPDIR ?? "/tmp"}/larry-agent-run-test-${process.pid}.json`;
  return {
    params: undefined as undefined | Record<string, unknown>,
    reply: "[Maya] Bye for now!\n[Larry] You asked great questions.",
    beforeYield: undefined as undefined | ((params: Record<string, unknown>) => Promise<void>),
  };
});

vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    beta = {
      messages: {
        toolRunner: (params: Record<string, unknown>) => {
          h.params = params;
          return (async function* () {
            await h.beforeYield?.(params);
            yield {
              content: [{ type: "text", text: h.reply }],
              stop_reason: "end_turn",
              usage: { input_tokens: 1000, output_tokens: 50 },
            };
          })();
        },
      },
    };
  }
  return { default: Anthropic };
});

const { runPairChat, practicePartner, groundFits, PRACTICE_ADDED_MAX } = await import("./agent");
const { PERSONAS, DEMO_PRIYA, DEMO_SAM } = await import("./demo");
const { PROFILE_ITEMS_MAX } = await import("./schemas");

const maya = PERSONAS.find((p) => p.id === "maya")!;
const turns = (n: number) =>
  Array.from({ length: n }, (_, i) => [
    { role: "user" as const, content: `[Sam] message ${i}` },
    { role: "assistant" as const, content: "[Maya] ok" },
  ]).flat();
const systemText = () => {
  const sys = h.params!.system;
  return typeof sys === "string" ? sys : (sys as { text: string }[]).map((s) => s.text).join("\n");
};
type Tool = { name: string; run: (args: unknown) => Promise<string> };
const tool = (name: string) => (h.params!.tools as Tool[]).find((t) => t.name === name)!;

beforeEach(() => {
  h.params = undefined;
  h.beforeYield = undefined;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("practice wrap-up follows the fade", () => {
  it("ends at 8 messages with no steps done", async () => {
    const seven = await runPairChat({ a: DEMO_SAM, b: maya.profile, persona: maya, history: turns(7), stepsDone: 0 });
    expect(seven.wrapUp).toBeUndefined();
    const eight = await runPairChat({ a: DEMO_SAM, b: maya.profile, persona: maya, history: turns(8), stepsDone: 0 });
    expect(eight.wrapUp).toBe(true);
  });

  it("ends at 4 messages once 2 real First Steps are done", async () => {
    const r = await runPairChat({ a: DEMO_SAM, b: maya.profile, persona: maya, history: turns(4), stepsDone: 2 });
    expect(r.wrapUp).toBe(true);
    expect(systemText()).toContain("THIS REPLY ENDS THE PRACTICE ROUND");
    expect(r.steps).toHaveLength(1);
  });

  it("ends at 6 messages after 1 step", async () => {
    expect((await runPairChat({ a: DEMO_SAM, b: maya.profile, persona: maya, history: turns(5), stepsDone: 1 })).wrapUp).toBeUndefined();
    expect((await runPairChat({ a: DEMO_SAM, b: maya.profile, persona: maya, history: turns(6), stepsDone: 1 })).wrapUp).toBe(true);
  });
});

describe("reply rules in the prompt", () => {
  it("asks for one easy question, short replies, and a grounded This-or-That game", async () => {
    h.reply = "Hi Sam and Priya. Sam, have you seen Coco?";
    await runPairChat({ a: DEMO_SAM, b: DEMO_PRIYA, history: [] });
    const sys = systemText();
    expect(sys).toMatch(/At most ONE question/);
    expect(sys).toMatch(/At most 2 short sentences/);
    expect(sys).toMatch(/yes-or-no/);
    expect(sys).toMatch(/This-or-That/);
    expect(sys).toMatch(/taken only from the bridges or picks/);
  });
});

describe("add_interest", () => {
  const searchHit = (image: string) =>
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: [{ entity_id: "new-1", name: "Stardew Valley", types: ["urn:entity:videogame"], properties: { image: { url: image } } }],
        }),
        { status: 200 },
      ),
    );

  it("drops images a later request would reject, and flags common ground as out of date", async () => {
    vi.stubEnv("QLOO_KEY", "test");
    vi.stubGlobal("fetch", searchHit(`http://images.example/${"x".repeat(400)}.jpg`));
    let out = "";
    h.beforeYield = async () => {
      out = await tool("add_interest").run({ person: "a", name: "Stardew Valley" });
    };
    h.reply = "Added it. Priya, have you played it?";
    const a = structuredClone(DEMO_SAM);
    const r = await runPairChat({ a, b: structuredClone(DEMO_PRIYA), history: [{ role: "user", content: "[Sam] I love Stardew" }] });
    expect(r.profileUpdates).toEqual([{ person: "a", item: { id: "new-1", name: "Stardew Valley", domain: "videogame", image: undefined } }]);
    expect(out).toContain("out of date");
  });

  it("stops adding when the card is full", async () => {
    vi.stubEnv("QLOO_KEY", "test");
    const fetchMock = searchHit("https://images.qloo.com/i/x.jpg");
    vi.stubGlobal("fetch", fetchMock);
    const full = {
      name: "Sam",
      items: Array.from({ length: PROFILE_ITEMS_MAX }, (_, i) => ({ id: `id-${i}`, name: `Pick ${i}`, domain: "movie" as const })),
    };
    let out = "";
    h.beforeYield = async () => {
      out = await tool("add_interest").run({ person: "a", name: "Stardew Valley" });
    };
    const r = await runPairChat({ a: full, b: structuredClone(DEMO_PRIYA), history: [{ role: "user", content: "[Sam] hi" }] });
    expect(out).toMatch(/full/);
    expect(r.profileUpdates).toEqual([]);
    expect(full.items).toHaveLength(PROFILE_ITEMS_MAX);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("practicePartner", () => {
  it("keeps the persona's own picks and up to a few added ones from the client", () => {
    const extra = Array.from({ length: 10 }, (_, i) => ({ id: `x${i}`, name: `Extra ${i}`, domain: "book" as const }));
    const sent = { name: "Someone Else", items: [{ ...maya.profile.items[0], name: "Renamed" }, ...extra] };
    const p = practicePartner(maya, sent);
    expect(p.name).toBe("Maya");
    expect(p.items.slice(0, maya.profile.items.length)).toEqual(maya.profile.items);
    expect(p.items).toHaveLength(maya.profile.items.length + PRACTICE_ADDED_MAX);
    expect(p.items.at(-1)?.id).toBe(`x${PRACTICE_ADDED_MAX - 1}`);
  });
});

describe("groundFits", () => {
  const spirited = { id: "s", name: "Spirited Away", domain: "movie" as const };
  const a = { name: "Sam", items: [spirited, { id: "m", name: "Minecraft", domain: "videogame" as const }] };
  const b = { name: "Priya", items: [spirited, { id: "h", name: "Heartstopper", domain: "tv_show" as const }] };
  const ground = {
    shared: [spirited],
    bridges: [{ id: "z", name: "Coco", domain: "movie" as const, affinity: 0.9, fromA: ["Minecraft"], fromB: ["Heartstopper"] }],
  };
  it("accepts ground that matches the cards", () => expect(groundFits(ground, a, b)).toBe(true));
  it("rejects ground whose shared picks or credits don't match the cards", () => {
    expect(groundFits({ ...ground, shared: [] }, a, b)).toBe(false);
    expect(groundFits({ ...ground, bridges: [{ ...ground.bridges[0], fromA: ["Not On The Card"] }] }, a, b)).toBe(false);
  });
});

// Keep the temp spend file out of the way of other runs.
afterEach(async () => {
  const { promises: fs } = await import("node:fs");
  await fs.rm(process.env.ANTHROPIC_SPEND_FILE ?? path.join(os.tmpdir(), "nope"), { force: true });
});
