import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type FingerprintView,
  fallbackCaption,
  fallbackTwin,
  fingerprintShareText,
  askMeLine,
  askMePlain,
  lessKnownCount,
  lessKnownLine,
  makeYourOwnLink,
  MAKE_YOUR_OWN_PATH,
  offBeatenPct,
  overlapShareText,
  safeLines,
  shareSafe,
  strongestDomains,
  TITLE_WORDS,
  twinSentence,
  validCaption,
} from "./fingerprint";
import type { TasteItem } from "./types";

// Qloo and the model are mocked: no real call is made.
const h = vi.hoisted(() => {
  process.env.ANTHROPIC_SPEND_FILE = `${process.env.TMPDIR ?? "/tmp"}/fingerprint-test-${process.pid}.json`;
  return { calls: 0, reply: "" as string, stop: "end_turn" };
});
vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    static APIError = class extends Error {};
    static AuthenticationError = class extends Error {};
    static RateLimitError = class extends Error {};
    beta = {
      messages: {
        create: async () => {
          h.calls++;
          return { content: [{ type: "text", text: h.reply }], stop_reason: h.stop, usage: { input_tokens: 900, output_tokens: 80 } };
        },
      },
    };
  }
  return { default: Anthropic };
});

const item = (id: string, name: string, domain: TasteItem["domain"]): TasteItem => ({ id, name, domain });
const MINECRAFT = item("CDBDE254-71F0-4640-8D04-5373BEAE5278", "Minecraft", "videogame");
const STARDEW = item("A0000000-0000-4000-8000-000000000002", "Stardew Valley", "videogame");
const FLEET = item("17CA60C4-D34B-4D9C-B6BC-E1CD59BDFAA5", "Fleet Foxes", "artist");
const SPIRITED = item("9B33A620-68CA-49B3-BFCF-F09CCF8AD595", "Spirited Away", "movie");

describe("the less-known count (P3: one 0.9 line, 3-pick minimum)", () => {
  it("counts picks outside Qloo's top 10%, out of the picks Qloo knows", () => {
    // Verified live: Minecraft 0.966, Spirited Away 0.9996: both well known under 0.9.
    const picks = [{ item: MINECRAFT, popularity: 0.966 }, { item: SPIRITED, popularity: 0.9996 }, { item: FLEET, popularity: 0.5 }, { item: STARDEW, popularity: 0.85 }];
    expect(lessKnownCount(picks)).toEqual({ count: 2, known: 4 });
    expect(offBeatenPct(picks)).toBe(50);
    expect(lessKnownLine({ count: 2, known: 4 })).toBe("2 of your 4 picks are outside the top 10% most popular.");
    expect(lessKnownLine({ count: 1, known: 3 }, "my")).toBe("1 of my 3 picks is outside the top 10% most popular.");
  });
  it("says 'classics' kindly, never 'basic', for a card of well-known picks", () => {
    expect(lessKnownLine({ count: 0, known: 3 })).toMatch(/^You like the classics/);
    expect(lessKnownLine({ count: 0, known: 3 })).not.toMatch(/basic|%/);
  });
  it("is left out, never guessed, under 3 known picks", () => {
    expect(lessKnownCount([{ item: MINECRAFT }, { item: FLEET }])).toBeUndefined();
    expect(lessKnownCount([{ item: MINECRAFT, popularity: 0.5 }, { item: FLEET, popularity: 0.5 }, { item: SPIRITED }])).toBeUndefined();
    expect(offBeatenPct([{ item: MINECRAFT, popularity: 0.5 }, { item: FLEET }])).toBeUndefined();
    expect(lessKnownLine(undefined)).toBe("");
  });
});

describe("Ask-me line (the Taste Twin as a question)", () => {
  const twin = { fromDomain: "videogame" as const, toDomain: "artist" as const, entity: item("2", "beabadoobee", "artist") };
  it("is short, and its plain line names the real pick behind it", () => {
    expect(askMeLine(twin)).toBe("Ask me about beabadoobee.");
    expect(askMeLine(twin).split(" ").length).toBeLessThanOrEqual(12);
    expect(askMePlain(twin, "Minecraft")).toBe("Larry found that people who like Minecraft also like beabadoobee.");
    expect(askMeLine(undefined)).toBe("");
  });
});

describe("share QR: make your own card, never a link between people", () => {
  it("opens /create and carries nothing about the sharer", () => {
    expect(MAKE_YOUR_OWN_PATH).toBe("/create");
    const link = makeYourOwnLink("https://larry.example/");
    expect(link).toBe("https://larry.example/create");
    expect(link).not.toMatch(/join|pair|room|group|\?/);
  });
});

describe("strongestDomains", () => {
  it("ranks by number of picks, then the less mainstream category", () => {
    const picks = [
      { item: SPIRITED, popularity: 0.9999 },
      { item: FLEET, popularity: 0.6 },
      { item: MINECRAFT, popularity: 0.96 },
      { item: STARDEW, popularity: 0.97 },
    ];
    expect(strongestDomains(picks)).toEqual(["videogame", "artist"]);
  });
});

describe("Taste Twin", () => {
  it("is a full sentence, never an arrow", () => {
    const twin = { fromDomain: "videogame" as const, toDomain: "artist" as const, entity: item("x", "beabadoobee", "artist") };
    expect(twinSentence(twin, "Minecraft")).toBe("Your Minecraft side, in music: beabadoobee.");
    expect(twinSentence(twin)).toBe("Your games side, in music: beabadoobee.");
    expect(twinSentence(undefined)).toBe("");
  });
  it("the fallback prefers a less mainstream true pick", () => {
    const base = { fromDomain: "videogame" as const, toDomain: "artist" as const };
    const big = { ...base, entity: item("1", "Taylor Swift", "artist"), affinity: 0.9, popularity: 0.9999 };
    const gem = { ...base, entity: item("2", "beabadoobee", "artist"), affinity: 0.7, popularity: 0.85 };
    expect(fallbackTwin([big, gem])?.entity.name).toBe("beabadoobee");
    expect(fallbackTwin([])).toBeUndefined();
  });
});

describe("Larry's caption", () => {
  const fp: FingerprintView = { offBeatenPct: 72, strongest: ["videogame", "artist"], twin: { fromDomain: "videogame", toDomain: "artist", entity: item("2", "beabadoobee", "artist") } };
  it("accepts a short line that only uses the real names and number", () => {
    expect(validCaption("72% of your picks skip the crowd. Minecraft fans rarely end up with beabadoobee, but you would.", ["Minecraft", "beabadoobee"], 72)).toBeTruthy();
  });
  it("rejects invented names, other numbers, emoji, titles, Glory and dates", () => {
    const names = ["Minecraft", "beabadoobee"];
    expect(validCaption("You and Taylor Swift would get along.", names, 72)).toBeNull();
    expect(validCaption("90% indie energy.", names, 72)).toBeNull();
    expect(validCaption("Pure indie energy 🎧", names, 72)).toBeNull(); // taste-skill-ignore: proves emoji are rejected
    expect(validCaption("A true Final Boss of taste.", names, 72)).toBeNull();
    expect(validCaption("Worth 300 Glory at least.", names, 72)).toBeNull();
    expect(validCaption("See you on Saturday.", names, 72)).toBeNull();
    expect(validCaption("Wow!", names, 72)).toBeNull();
    expect(validCaption("x".repeat(200), names, 72)).toBeNull();
    expect(validCaption(42, names, 72)).toBeNull();
  });
  it("has a fixed, grounded fallback that is itself share-safe", () => {
    const line = fallbackCaption(fp, { seed: "abc" });
    expect(line).toMatch(/quiet corners/);
    expect(shareSafe(line, { names: ["beabadoobee"] })).toBe(true);
    expect(fallbackCaption({ strongest: [] })).toBe("A card with its own mind.");
    expect(fallbackCaption({ ...fp, offBeatenPct: 10 }, { seed: "abc" })).toMatch(/big hits/);
  });
});

describe("share images: never a venue, title, Glory or date (hard rule)", () => {
  const venue = "Dice & Tea Board Game Cafe";
  const bad = [
    "Final Boss at the café",
    "Guildmaster",
    "Party Leader of the crew",
    "Rookie here",
    "312 Glory",
    "Checked in 30 Oct",
    "Oct 30th was fun",
    "2026-10-30",
    "30/10/2026",
    "See you Saturday",
    "Tonight at 7pm",
    "Back at 18:30",
    `Met at ${venue}`,
  ];
  it.each(bad)("drops %s", (line) => {
    expect(shareSafe(line, { venues: [venue] })).toBe(false);
  });
  it("covers every title word and Glory", () => {
    expect(TITLE_WORDS).toEqual(expect.arrayContaining(["Rookie", "Regular", "Veteran", "Elite", "Legend", "Final Boss", "Guildmaster", "Shogun", "Party Leader", "Squad Captain", "Crew Leader", "Host", "Glory"]));
    for (const w of TITLE_WORDS) expect(shareSafe(`You are ${w}`)).toBe(false);
  });
  it("keeps real item names that happen to hold a title word or a year", () => {
    expect(shareSafe("Your Minecraft side, in games: The Legend of Zelda.", { names: ["The Legend of Zelda"] })).toBe(true);
    expect(shareSafe("Blade Runner 2049", { names: ["Blade Runner 2049"] })).toBe(true);
    expect(shareSafe("72% off the beaten path")).toBe(true);
  });
  it("the Fingerprint image text carries none of them, even if the data tried", () => {
    const fp: FingerprintView = {
      offBeatenPct: 72,
      strongest: ["videogame"],
      twin: { fromDomain: "videogame", toDomain: "artist", entity: item("2", "beabadoobee", "artist") },
      caption: "Final Boss energy on 30 Oct.",
    };
    const share = fingerprintShareText({ ...fp, lessKnown: { count: 4, known: 6 } }, "Sam", [venue]);
    const all = Object.values(share).join(" | ");
    expect(share.caption).toBe("");
    expect(share.stat).toBe("4 of my 6 picks are outside the top 10% most popular.");
    expect(share.twin).toBe("Ask me about beabadoobee.");
    expect(share.subtitle).toBe("Talk to someone, not something.");
    // Never the old percentage or "Strongest in".
    expect(all).not.toMatch(/off the beaten path|Strongest in|\d+% off/);
    for (const word of [...TITLE_WORDS, venue, "Oct", "2026"]) expect(all).not.toContain(word);
  });
  it("the overlap image text drops venues and keeps only real items", () => {
    const share = overlapShareText({ names: ["Sam", "Priya"], shared: ["Spirited Away"], bridges: [venue, "mxmtoon", "Jojo Rabbit"] }, [venue]);
    expect(share.title).toBe("Sam and Priya: our overlap");
    expect(share.count).toBe("1 you both picked · 3 you might both like");
    expect(share.things).toEqual(["Spirited Away", "mxmtoon"]);
    expect(safeLines([venue, "mxmtoon", null], { venues: [venue] })).toEqual(["mxmtoon"]);
  });
});

/* ---------------------------------------------------------------- POST /api/fingerprint */

const { POST } = await import("@/app/api/fingerprint/route");

describe("POST /api/fingerprint", () => {
  let qlooCalls: string[] = [];
  const card = { name: "Sam", items: [MINECRAFT, STARDEW, FLEET] };
  const post = (data: unknown, ip: string, headers: Record<string, string> = {}) =>
    POST(new Request("http://localhost/api/fingerprint", { method: "POST", headers: { "x-real-ip": ip, ...headers }, body: JSON.stringify(data) }));

  beforeEach(() => {
    qlooCalls = [];
    h.calls = 0;
    vi.stubEnv("QLOO_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string) => {
        const url = new URL(String(input));
        qlooCalls.push(url.pathname);
        if (url.pathname === "/entities") {
          const pops: Record<string, number> = { [MINECRAFT.id]: 0.966, [STARDEW.id]: 0.85, [FLEET.id]: 0.9994 };
          const ids = (url.searchParams.get("entity_ids") ?? "").split(",");
          return Response.json({ results: ids.map((id) => ({ entity_id: id, name: id, popularity: pops[id] })) });
        }
        const type = url.searchParams.get("filter.type");
        const ents =
          type === "urn:entity:movie"
            ? [
                { entity_id: "T1", name: "Barbie", types: [type], popularity: 0.9999, query: { affinity: 0.9 } },
                { entity_id: "T2", name: "Paprika", types: [type], popularity: 0.82, query: { affinity: 0.8, explainability: { "signal.interests.entities": [{ entity_id: MINECRAFT.id, score: 0.4 }] } } },
              ]
            : [{ entity_id: `M-${type}`, name: `Pick for ${type?.split(":").pop()}`, types: [type], popularity: 0.999, query: { affinity: 0.6 } }];
        return Response.json({ results: { entities: ents } });
      }),
    );
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    const { promises: fs } = await import("node:fs");
    await fs.rm(process.env.ANTHROPIC_SPEND_FILE!, { force: true });
  });

  it("answers from real Qloo scores with the fallback twin and caption when there is no code (no model call)", async () => {
    const res = await post({ card }, "198.51.100.11");
    expect(res.status).toBe(200);
    const fp = (await res.json()) as FingerprintView;
    expect(fp.offBeatenPct).toBe(33);
    expect(fp.strongest).toEqual(["videogame", "artist"]);
    expect(fp.twin?.entity.name).toBe("Paprika");
    expect(fp.twinBecause).toBe("Minecraft");
    expect(fp.captionSource).toBe("fallback");
    expect(fp.caption).toBeTruthy();
    expect(h.calls).toBe(0);
    expect(qlooCalls[0]).toBe("/entities");
    expect(qlooCalls.filter((p) => p === "/v2/insights").length).toBeLessThanOrEqual(3);
  });

  it("a second request for the same card costs no Qloo call", async () => {
    const other = { name: "Sam", items: [FLEET, SPIRITED] };
    await post({ card: other }, "198.51.100.12");
    const n = qlooCalls.length;
    await post({ card: other }, "198.51.100.12");
    expect(qlooCalls.length).toBe(n);
  });

  it("an empty card gets an empty Fingerprint without calling Qloo", async () => {
    const res = await post({ card: { name: "Sam", items: [] } }, "198.51.100.13");
    expect(await res.json()).toEqual({ strongest: [] });
    expect(qlooCalls).toEqual([]);
  });

  it("refuses a bad body warmly", async () => {
    const res = await post({ nope: true }, "198.51.100.14");
    expect(res.status).toBe(400);
  });

  it("Larry picks the surprising true twin and writes the caption when the model can run", async () => {
    vi.stubEnv("LARRY_ALLOW_NO_CODE", "1");
    vi.stubEnv("ANTHROPIC_API_KEY", "test");
    h.reply = JSON.stringify({ twin: 1, caption: "You found Minecraft and somehow landed on Paprika. That tracks." });
    const res = await post({ card: { name: "Lee", items: [MINECRAFT, STARDEW, FLEET] } }, "198.51.100.16");
    const fp = (await res.json()) as FingerprintView;
    expect(h.calls).toBe(1);
    expect(fp.captionSource).toBe("model");
    expect(fp.caption).toMatch(/Paprika/);
  });

  it("an off-script caption from the model falls back to the fixed line", async () => {
    vi.stubEnv("LARRY_ALLOW_NO_CODE", "1");
    vi.stubEnv("ANTHROPIC_API_KEY", "test");
    h.reply = JSON.stringify({ twin: 99, caption: "Final Boss of taste since 2019!" });
    const res = await post({ card: { name: "Kim", items: [MINECRAFT, STARDEW, FLEET] } }, "198.51.100.17");
    const fp = (await res.json()) as FingerprintView;
    expect(h.calls).toBe(1);
    expect(fp.captionSource).toBe("fallback");
    expect(fp.twin?.entity.name).toBe("Paprika");
  });

  it("rate-limits per IP", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await post({ card: { name: "Ann", items: [SPIRITED] } }, "198.51.100.15")).status);
    expect(statuses).toContain(429);
  });
});
