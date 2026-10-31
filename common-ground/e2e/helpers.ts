import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Page, Route } from "@playwright/test";
import { encodeProfile } from "../src/lib/card-codec";
import type { ChatEvent, PairChatResult } from "../src/lib/chat-protocol";
import { DEMO_PRIYA, DEMO_SAM } from "../src/lib/demo";
import type { CommonGround, FirstStep, Place, Profile } from "../src/lib/types";

export const SAM = DEMO_SAM;
export const PRIYA = DEMO_PRIYA;
export const code = (p: Profile) => encodeProfile(p);

/**
 * A small, fixed common ground so pair tests don't depend on Qloo's live answer. Like the real
 * example pair, Sam and Priya share no favourite: everything here is a two-signal bridge.
 */
export const GROUND: CommonGround = {
  shared: [],
  bridges: [
    {
      id: "7826DA9C-F761-42A1-A948-90A700082B80",
      name: "mxmtoon",
      domain: "artist",
      affinity: 0.93,
      fromA: ["Avatar: The Last Airbender"],
      fromB: ["Heartstopper"],
      scoreA: 0.17,
      scoreB: 0.18,
    },
    {
      id: "B1A2C3D4-0000-4000-8000-000000000001",
      name: "Jojo Rabbit",
      domain: "movie",
      affinity: 0.81,
      fromA: ["Minecraft"],
      fromB: ["Little Women"],
    },
  ],
};

/** The same ground with one favourite both people picked, for the "You both picked" paths. */
export const GROUND_SHARED: CommonGround = { ...GROUND, shared: [SAM.items[0]] }; // Spirited Away

export const PLACES: Place[] = [
  {
    id: "p1",
    name: "Dice & Tea Board Game Café",
    distanceKm: 1.2,
    tags: ["Cafe"],
    affinity: 0.9,
    reason: "A board-game café. Easy to sit and play. Fans of Minecraft go here.",
  },
];

/** Answers /api/common-ground with a fixed result (no Qloo call). */
export async function mockCommonGround(page: Page, ground: CommonGround = GROUND) {
  await page.route("**/api/common-ground", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ground) }),
  );
}

const REAL_GROUND_CACHE = path.join(__dirname, "../test-results/.real-common-ground.json");

/**
 * Lets /api/common-ground reach the real server (and Qloo), but only once per test run: one full
 * scan is about 13 Qloo calls, and two projects scanning at once can hit Qloo's rate limit. A 429
 * is retried after a pause; the first real answer is shared with the other workers through a file.
 */
export async function realCommonGround(page: Page) {
  await page.route("**/api/common-ground", async (route) => {
    const fresh = existsSync(REAL_GROUND_CACHE) && Date.now() - statSync(REAL_GROUND_CACHE).mtimeMs < 10 * 60_000;
    if (fresh) {
      return route.fulfill({ status: 200, contentType: "application/json", body: readFileSync(REAL_GROUND_CACHE, "utf8") });
    }
    for (let attempt = 0; ; attempt++) {
      const res = await route.fetch();
      if (res.status() === 429 && attempt < 4) {
        await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
        continue;
      }
      const body = await res.text();
      if (res.ok()) {
        mkdirSync(path.dirname(REAL_GROUND_CACHE), { recursive: true });
        writeFileSync(REAL_GROUND_CACHE, body);
      }
      return route.fulfill({ status: res.status(), contentType: "application/json", body });
    }
  });
}

/** Answers /api/places with fixed places (no Qloo call). Returns how many times it was hit. */
export async function mockPlaces(page: Page, places: Place[] = PLACES) {
  const calls = { n: 0 };
  await page.route("**/api/places", (route) => {
    calls.n++;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ places }) });
  });
  return calls;
}

export const done = (result: Partial<PairChatResult> & Pick<PairChatResult, "messages">): ChatEvent => ({
  type: "done",
  result: { quiet: false, steps: [], profileUpdates: [], ...result },
});

export interface ChatRequest {
  history: { role: "user" | "assistant"; content: string }[];
  persona?: string;
  stepsDone?: number;
  [key: string]: unknown;
}

export interface ChatReply {
  events: ChatEvent[];
  /** Pause between events. Above 0 the reply is truly streamed, so progress text can be seen. */
  gapMs?: number;
}

/**
 * A local NDJSON server for replies that must arrive in pieces. `route.fulfill` delivers a body
 * all at once, so a progress event would never be painted; continuing the intercepted request to
 * this server streams it through the browser's network stack instead.
 */
export async function startStreamServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      const { events, gapMs } = JSON.parse(raw) as Required<ChatReply>;
      res.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" });
      for (const [i, e] of events.entries()) {
        if (i > 0) await new Promise((r) => setTimeout(r, gapMs));
        res.write(JSON.stringify(e) + "\n");
      }
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/chat`,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

/**
 * Mocks /api/chat so no test ever reaches the model. `reply` gets the parsed request and the
 * call number (0 for Larry's opening) and returns the events to send. Returns the requests seen.
 */
export async function mockChat(
  page: Page,
  reply: (req: ChatRequest, n: number) => ChatReply | ChatEvent[],
  stream?: { url: string },
) {
  const requests: ChatRequest[] = [];
  await page.route("**/api/chat", async (route: Route) => {
    const req = JSON.parse(route.request().postData() ?? "{}") as ChatRequest;
    const out = reply(req, requests.length);
    requests.push(req);
    const { events, gapMs = 0 } = Array.isArray(out) ? { events: out } : out;
    if (gapMs > 0 && stream) {
      await route.continue({ url: stream.url, postData: JSON.stringify({ events, gapMs }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    });
  });
  return requests;
}

/** Seeds this device's saved card and steps before any page script runs. */
export async function seedStorage(page: Page, data: { profile?: Profile; steps?: FirstStep[] }) {
  await page.addInitScript(
    ([profile, steps]) => {
      // Only once per tab, so what the app writes later survives reloads and navigation.
      if (sessionStorage.getItem("e2e.seeded")) return;
      sessionStorage.setItem("e2e.seeded", "1");
      if (profile) localStorage.setItem("cg.profile", profile);
      if (steps) localStorage.setItem("cg.steps", steps);
    },
    [data.profile ? JSON.stringify(data.profile) : null, data.steps ? JSON.stringify(data.steps) : null] as const,
  );
}

/** Accessible name of a taste card's heading. */
export const cardHeading = (name: string) => `${name}'s taste card`;

/** A real opening from Larry for the example pair (with Jojo Rabbit in the ground). It ends by asking Priya. */
export const OPENING =
  "Hi Sam and Priya, I'm Larry, an AI pal. You might both like the film Jojo Rabbit, because Sam likes Minecraft and Priya likes Little Women. Priya, have you seen Sam's pick, Spirited Away?";

/** A chat reply from Larry with one line. */
export const larrySays = (text: string): ChatEvent[] => [done({ messages: [{ from: "larry", text }] })];
