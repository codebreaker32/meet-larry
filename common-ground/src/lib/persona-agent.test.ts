import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Larry using and updating a persona. The model is mocked; Qloo is stubbed.
const h = vi.hoisted(() => {
  process.env.ANTHROPIC_SPEND_FILE = `${process.env.TMPDIR ?? "/tmp"}/larry-persona-test-${process.pid}.json`;
  return {
    params: undefined as undefined | Record<string, unknown>,
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
            yield { content: [{ type: "text", text: "Noted. Want a game like it?" }], stop_reason: "end_turn", usage: { input_tokens: 900, output_tokens: 30 } };
          })();
        },
      },
    };
  }
  return { default: Anthropic };
});

const { runGroupChat, runPairChat } = await import("./agent");
const { personaSchema } = await import("./schemas");
import type { GroupMember, Persona } from "./contracts";

type Tool = { name: string; run: (args: unknown) => Promise<string> };
const tool = (name: string) => (h.params!.tools as Tool[]).find((t) => t.name === name)!;
const userText = () => (h.params!.messages as { content: string }[]).map((m) => m.content).join("\n");

const persona: Persona = {
  version: 1,
  name: "Sam",
  likes: [
    { id: "a1", name: "Minecraft", domain: "videogame" },
    { id: "old", name: "Hollow Knight", domain: "videogame" },
  ],
  dislikes: [{ name: "Fortnite", id: "fn", domain: "videogame" }],
  notes: ["prefers calm places"],
  placeVibe: "calm",
  updatedAt: 1,
};
const me: GroupMember = { id: "me", name: "Sam", color: "var(--film)", profile: { name: "Sam", items: [{ id: "a1", name: "Minecraft", domain: "videogame" }] } };

let insightSignals: string[] = [];
beforeEach(() => {
  h.params = undefined;
  h.beforeYield = undefined;
  insightSignals = [];
  vi.stubEnv("QLOO_KEY", "test");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL | string) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith("/search")) {
        const q = u.searchParams.get("query") ?? "";
        const hit = q.toLowerCase().startsWith("stardew")
          ? { entity_id: "sv", name: "Stardew Valley", types: ["urn:entity:videogame"] }
          : { entity_id: "ow", name: "Overwatch", types: ["urn:entity:videogame"] };
        return new Response(JSON.stringify({ results: [hit] }), { status: 200 });
      }
      insightSignals.push(u.searchParams.get("signal.interests.entities") ?? "");
      const entities = [
        { entity_id: "fn", name: "Fortnite", types: ["urn:entity:videogame"], query: { affinity: 0.99 } },
        { entity_id: "cel", name: "Celeste", types: ["urn:entity:videogame"], query: { affinity: 0.9, explainability: { "signal.interests.entities": [{ entity_id: "old", score: 1 }] } } },
      ];
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

describe("persona in talk taste (solo)", () => {
  it("gives the model the persona as data, uses its likes as signal, and skips dislikes", async () => {
    let recs = "";
    h.beforeYield = async () => {
      recs = await tool("recommend").run({ domain: "videogame" });
    };
    await runGroupChat({ mode: "solo", members: [me], history: [{ role: "user", content: "what should I play?" }], personas: { me: persona } });
    expect(userText()).toContain('"persona":{"more_likes":[{"name":"Hollow Knight"');
    expect(userText()).toContain('"place_vibe":"calm"');
    expect(insightSignals[0]).toBe("a1,old");
    expect(recs).toContain("Celeste");
    expect(recs).not.toContain("Fortnite");
  });

  it("returns what Larry learned: real Qloo likes, dislikes, notes and place vibe, never sensitive notes or routines", async () => {
    const outs: string[] = [];
    h.beforeYield = async () => {
      outs.push(await tool("add_interest").run({ name: "Stardew" }));
      outs.push(await tool("remember").run({ dislike: "Overwatch", note: "plays chess", place_vibe: "cosy" }));
      outs.push(await tool("remember").run({ note: "lives at 12 Hill Road" }));
      outs.push(await tool("remember").run({ note: "feels anxious in crowds" }));
      // Routines are private: days, times and places someone goes would let a stranger find them.
      for (const note of ["plays chess at weekends", "goes to Title Waves on Saturdays", "usually at the library after 4pm", "plays cricket on Sundays"]) {
        outs.push(await tool("remember").run({ note }));
      }
    };
    const r = await runGroupChat({ mode: "solo", members: [me], history: [{ role: "user", content: "I love Stardew, Overwatch is not for me" }], personas: { me: persona } });
    expect(r.personaUpdate).toEqual({
      addLikes: [{ id: "sv", name: "Stardew Valley", domain: "videogame", image: undefined }],
      addDislikes: [{ name: "Overwatch", id: "ow", domain: "videogame" }],
      addNotes: ["plays chess"],
      placeVibe: "cosy",
    });
    expect(outs[2]).toMatch(/^Not saved/);
    expect(outs[3]).toMatch(/^Not saved/);
    for (const out of outs.slice(4)) expect(out).toMatch(/^Not saved: notes never hold days, times or places/);
  });

  it("keeps learning likes into the persona when the card is full", async () => {
    const full = { ...me, profile: { name: "Sam", items: Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, name: `Pick ${i}`, domain: "movie" as const })) } };
    let out = "";
    h.beforeYield = async () => {
      out = await tool("add_interest").run({ name: "Stardew" });
    };
    const r = await runGroupChat({ mode: "solo", members: [full], history: [{ role: "user", content: "Stardew!" }], personas: { me: persona } });
    expect(out).toContain("added_to_persona");
    expect(r.profileUpdates).toEqual([]);
    expect(r.personaUpdate?.addLikes.map((i) => i.id)).toEqual(["sv"]);
  });
});

describe("persona in a pair", () => {
  it("only learns about the phone owner's seat", async () => {
    const outs: string[] = [];
    h.beforeYield = async () => {
      outs.push(await tool("remember").run({ person: "b", note: "likes jazz" }));
      outs.push(await tool("remember").run({ person: "a", place_vibe: "lively" }));
    };
    const r = await runPairChat({
      a: me.profile,
      b: { name: "Priya", items: [{ id: "b1", name: "Fleet Foxes", domain: "artist" }] },
      history: [{ role: "user", content: "[Sam] hi" }],
      myPersona: persona,
    });
    expect(outs[0]).toMatch(/^Not saved/);
    expect(r.personaUpdate).toEqual({ addLikes: [], addDislikes: [], addNotes: [], placeVibe: "lively" });
  });
});

describe("personaSchema", () => {
  it("cleans names and notes and caps the lists", () => {
    const p = personaSchema.parse({
      ...persona,
      name: "<Sam>",
      notes: ["visit https://evil.example now", "call 5551234567", "", "prefers calm places"],
    });
    expect(p.name).toBe("Sam");
    expect(p.notes).toEqual(["visit now", "call", "prefers calm places"]);
    expect(() => personaSchema.parse({ ...persona, version: 2 })).toThrow();
  });
});
