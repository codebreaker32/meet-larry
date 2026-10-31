import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The model is mocked: no real Anthropic call is made. Qloo is stubbed per test.
const h = vi.hoisted(() => {
  process.env.ANTHROPIC_SPEND_FILE = `${process.env.TMPDIR ?? "/tmp"}/larry-group-chat-test-${process.pid}.json`;
  return {
    params: undefined as undefined | Record<string, unknown>,
    calls: 0,
    reply: "Hi all. Jo, have you seen Coco?",
    stop: "end_turn",
    beforeYield: undefined as undefined | (() => Promise<void>),
  };
});

vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    beta = {
      messages: {
        toolRunner: (params: Record<string, unknown>) => {
          h.params = params;
          h.calls++;
          return (async function* () {
            await h.beforeYield?.();
            yield { content: [{ type: "text", text: h.reply }], stop_reason: h.stop, usage: { input_tokens: 1000, output_tokens: 40 } };
          })();
        },
      },
    };
  }
  return { default: Anthropic };
});

const { runGroupChat, groupState, oneQuestion, CRISIS_TEXT } = await import("./agent");
import type { GroupGround, GroupMember } from "./contracts";
import type { Domain } from "./types";

const item = (id: string, name: string, domain: Domain) => ({ id, name, domain });
const member = (id: string, name: string, items: ReturnType<typeof item>[]): GroupMember => ({ id, name, color: "var(--film)", profile: { name, items } });
const sam = () => member("m-sam", "Sam", [item("a1", "Minecraft", "videogame")]);
const priya = () => member("m-priya", "Priya", [item("b1", "Heartstopper", "tv_show")]);
const jo = () => member("m-jo", "Jo", [item("c1", "Fleet Foxes", "artist")]);
const ground: GroupGround = {
  shared: [],
  bridges: [{ id: "coco", name: "Coco", domain: "movie", affinity: 0.8, from: { "m-sam": ["Minecraft"], "m-jo": ["Fleet Foxes"] } }],
};

const userText = () => {
  const msgs = h.params!.messages as { role: string; content: string }[];
  return msgs.map((m) => m.content).join("\n");
};
const systemText = () => {
  const sys = h.params!.system;
  return typeof sys === "string" ? sys : (sys as { text: string }[]).map((s) => s.text).join("\n");
};
type Tool = { name: string; run: (args: unknown) => Promise<string> };
const tool = (name: string) => (h.params!.tools as Tool[]).find((t) => t.name === name)!;

beforeEach(() => {
  h.params = undefined;
  h.calls = 0;
  h.stop = "end_turn";
  h.beforeYield = undefined;
  h.reply = "Hi all. Jo, have you seen Coco?";
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  const { promises: fs } = await import("node:fs");
  await fs.rm(process.env.ANTHROPIC_SPEND_FILE!, { force: true });
});

describe("runGroupChat: crisis first", () => {
  it("answers a crisis line said in Just us mode with fixed help, without calling the model", async () => {
    const r = await runGroupChat({
      mode: "group",
      members: [sam(), priya(), jo()],
      history: [
        { role: "assistant", content: "Hi all." },
        { role: "user", content: "[Jo] i don't want to be alive anymore" },
        { role: "user", content: "[Sam] what should we play?" },
      ],
      ground,
    });
    expect(r).toMatchObject({ crisis: true, messages: [{ from: "larry", text: CRISIS_TEXT }] });
    expect(h.calls).toBe(0);
  });

  it("solo too", async () => {
    const r = await runGroupChat({ mode: "solo", members: [sam()], history: [{ role: "user", content: "i wanna die" }] });
    expect(r.crisis).toBe(true);
    expect(h.calls).toBe(0);
  });
});

describe("runGroupChat: group", () => {
  it("in an Open to meet chat, tells the model the venue (as data) and the fixed safety rules", async () => {
    await runGroupChat({
      mode: "group",
      members: [sam(), priya()],
      history: [{ role: "user", content: "[Sam] hi" }],
      ground,
      meet: { venueName: "Dice Cafe" },
    });
    expect(userText()).toContain(`"open_to_meet_venue":"Dice Cafe"`);
    expect(systemText()).toContain("OPEN TO MEET");
    expect(systemText()).toMatch(/only place to meet is that venue/);
    expect(systemText()).toMatch(/phone numbers, social handles, addresses, ages/);
  });

  it("tells the model who hasn't spoken lately and whether the group has warmed up, as data", async () => {
    const history = [
      { role: "assistant" as const, content: "Hi all." },
      { role: "user" as const, content: "[Sam] hi" },
      { role: "user" as const, content: "[Priya] hey" },
      { role: "user" as const, content: "[Sam] what should we watch?" },
    ];
    await runGroupChat({ mode: "group", members: [sam(), priya(), jo()], history, ground });
    expect(userText()).toContain(`<room_state>{"not_spoken_lately":["Jo"],"warmed_up":false}</room_state>`);
    // Per-person reasons from the ground, by name; no real ids reach the model.
    expect(userText()).toContain(`"because":{"Sam":"Minecraft","Jo":"Fleet Foxes"}`);
    expect(userText()).not.toContain("m-sam");
    expect(systemText()).toMatch(/not spoken lately/);
    expect(systemText()).toMatch(/At most ONE question/);
    expect(systemText()).toMatch(/save_first_step once/);
  });

  it("still says it's an AI on its first reply when someone in the room spoke first", async () => {
    await runGroupChat({ mode: "group", members: [sam(), priya()], history: [{ role: "user", content: "[Sam] Hi Larry! Can you help us get started?" }], ground });
    expect(userText()).toMatch(/You have not spoken yet: .*an AI pal/);
    await runGroupChat({ mode: "group", members: [sam(), priya()], history: [{ role: "assistant", content: "Hi all." }, { role: "user", content: "[Sam] hi" }], ground });
    expect(userText()).not.toMatch(/You have not spoken yet/);
  });

  it("knows when a group has warmed up", () => {
    const members = [sam(), priya()];
    const turns = ["Sam", "Priya", "Sam", "Priya"].map((n) => ({ role: "user" as const, content: `[${n}] hi` }));
    expect(groupState(members, turns)).toEqual({ notSpokenLately: [], warmedUp: true });
    expect(groupState(members, turns.slice(0, 3)).warmedUp).toBe(false);
    expect(groupState([...members, jo()], turns).notSpokenLately).toEqual(["Jo"]);
  });

  it("fetches group ground for the opener so no tool round trip is needed", async () => {
    vi.stubEnv("QLOO_KEY", "test");
    vi.stubEnv("QLOO_RETRY_MS", "0");
    const e = (aff: number, who: string) => ({
      entity_id: "coco",
      name: "Coco",
      types: ["urn:entity:movie"],
      query: { affinity: aff, explainability: { "signal.interests.entities": [{ entity_id: who, score: 1 }] } },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | string) => {
        const p = new URL(String(url)).searchParams;
        const s = p.get("signal.interests.entities");
        const entities = p.get("filter.type") === "urn:entity:movie" ? [e(s === "a1" ? 0.9 : 0.7, s!)] : [];
        return new Response(JSON.stringify({ results: { entities } }), { status: 200 });
      }),
    );
    const r = await runGroupChat({ mode: "group", members: [sam(), priya(), jo()], history: [] });
    expect(r.ground?.bridges[0]).toMatchObject({ id: "coco", affinity: 0.7 });
    expect(userText()).toContain("common_ground");
    expect(userText()).toContain("Open the conversation");
    expect(r.messages).toEqual([{ from: "larry", text: "Hi all. Jo, have you seen Coco?" }]);
  });

  it("drops ground that doesn't fit the members", async () => {
    const bad: GroupGround = { shared: [], bridges: [{ ...ground.bridges[0], from: { "m-sam": ["Not On Card"], "m-jo": ["Fleet Foxes"] } }] };
    await runGroupChat({ mode: "group", members: [sam(), jo()], history: [{ role: "user", content: "[Sam] hi" }], ground: bad });
    expect(userText()).not.toContain("common_ground");
  });

  it("goes quiet on [quiet], and keeps only one question", async () => {
    h.reply = "[quiet]";
    const r = await runGroupChat({ mode: "group", members: [sam(), jo()], history: [{ role: "user", content: "[Sam] lol" }], ground });
    expect(r).toMatchObject({ quiet: true, messages: [] });
    expect(oneQuestion("Nice. Sam, Coco or Up? Jo, have you seen it?")).toBe("Nice. Jo, have you seen it?");
    expect(oneQuestion("Jo, have you seen Coco?")).toBe("Jo, have you seen Coco?");
  });

  it("saves a group First Step and maps added interests back to the member's real id", async () => {
    vi.stubEnv("QLOO_KEY", "test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | string) => {
        const u = new URL(String(url));
        if (u.pathname.endsWith("/search")) {
          return new Response(JSON.stringify({ results: [{ entity_id: "new-1", name: "Stardew Valley", types: ["urn:entity:videogame"] }] }), { status: 200 });
        }
        return new Response(JSON.stringify({ results: { entities: [] } }), { status: 200 });
      }),
    );
    const outs: string[] = [];
    h.beforeYield = async () => {
      outs.push(await tool("add_interest").run({ person: "p2", name: "Stardew" }));
      outs.push(await tool("save_first_step").run({ kind: "go", text: "Play Stardew together on Friday" }));
    };
    h.reply = "Saved it. Sam, are you in?";
    const r = await runGroupChat({ mode: "group", members: [sam(), priya(), jo()], history: [{ role: "user", content: "[Priya] I love Stardew" }], ground });
    expect(r.profileUpdates).toEqual([{ memberId: "m-priya", item: { id: "new-1", name: "Stardew Valley", domain: "videogame", image: undefined } }]);
    expect(r.steps).toEqual([{ kind: "go", text: "Play Stardew together on Friday", withPerson: undefined }]);
    expect(outs[1]).toBe("Saved for the group.");
  });
});

describe("runGroupChat: solo", () => {
  const turns = (n: number) =>
    Array.from({ length: n }, (_, i) => [
      { role: "user" as const, content: `message ${i}` },
      { role: "assistant" as const, content: "ok" },
    ]).flat();

  it("is honest it's an AI, not a companion, and gives the person's turns their name", async () => {
    h.reply = "Fans of Minecraft also like Stardew Valley. Want to try it?";
    const r = await runGroupChat({ mode: "solo", members: [sam()], history: [{ role: "user", content: "what should I play?" }] });
    expect(systemText()).toMatch(/not a friend or a companion/);
    expect(systemText()).toMatch(/honest that you are an AI/);
    expect(userText()).toContain("[Sam] what should I play?");
    expect(userText()).toContain(`<session>{"messages_left_after_this":7}</session>`);
    expect(r.wrapUp).toBeUndefined();
    expect((h.params!.tools as Tool[]).map((t) => t.name)).toEqual([
      "recommend",
      "add_interest",
      "find_places_nearby",
      "save_first_step",
      "remember",
      "make_plan_ticket",
    ]);
  });

  it("wraps up at the cap with a real step, pointing to a room or a First Step", async () => {
    h.reply = "Thanks for chatting.";
    const r = await runGroupChat({ mode: "solo", members: [sam()], history: turns(8), stepsDone: 0 });
    expect(r.wrapUp).toBe(true);
    expect(systemText()).toContain("THIS REPLY ENDS THE CHAT");
    expect(r.steps).toEqual([{ kind: "say", text: "Find someone who also likes Minecraft" }]);
  });

  it("gets shorter as real First Steps get done (the fade)", async () => {
    expect((await runGroupChat({ mode: "solo", members: [sam()], history: turns(3), stepsDone: 2 })).wrapUp).toBeUndefined();
    expect((await runGroupChat({ mode: "solo", members: [sam()], history: turns(4), stepsDone: 2 })).wrapUp).toBe(true);
  });

  it("never runs past the cap: after the end, no model call, just the way out again", async () => {
    const r = await runGroupChat({ mode: "solo", members: [sam()], history: turns(9) });
    expect(h.calls).toBe(0);
    expect(r.wrapUp).toBe(true);
    expect(r.messages[0].text).toMatch(/start a room/);
    expect(r.steps).toHaveLength(1);
  });
});
