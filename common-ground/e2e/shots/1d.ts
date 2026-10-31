// 1D Signals review screenshots: the age question, the one location ask, under 13, mood and Hidden
// Gems in Talk taste and pair, the mic listening (with language and honesty line), and room codes.
// Run with `npx tsx e2e/review-shots.ts 1d [job]`. Every model call is mocked at the HTTP boundary.
import { encodeProfile } from "../../src/lib/card-codec";
import { DEMO_PRIYA as PRIYA, DEMO_SAM as SAM } from "../../src/lib/demo";
import type { ShotJob, ShotKit } from "./_kit";

const ndjson = (events: unknown[]) => events.map((e) => JSON.stringify(e)).join("\n") + "\n";
const done = (result: Record<string, unknown>) => ({ type: "done", result: { messages: [], quiet: false, steps: [], profileUpdates: [], ...result } });
const persona = { version: 1, name: "Sam", likes: SAM.items, dislikes: [], notes: [], updatedAt: Date.now() };
const seed = {
  "larry.persona": JSON.stringify(persona),
  "larry.ageBucket": JSON.stringify("18-24"),
  "larry.location": JSON.stringify({ lat: 51.51, lon: -0.13, at: Date.now() }),
  "larry.location.choice": "on",
};
const OPENER = "Hi Sam, I'm Larry, an AI. You like Minecraft and Spirited Away. Films or games today?";

async function pickThree(page: import("@playwright/test").Page) {
  for (const t of ["Spirited Away", "Interstellar", "3 Idiots"]) await page.getByRole("button", { name: t, exact: true }).click();
  await page.getByLabel("Your first name").fill("Sam");
}

async function createAge(kit: ShotKit, w: number) {
  const ctx = await kit.context(w);
  const page = await ctx.newPage();
  await page.goto("/create");
  await pickThree(page);
  await page.getByRole("radiogroup", { name: "How old are you?" }).getByRole("radio", { name: "18–24" }).click();
  await page.getByRole("group", { name: /How are you feeling today/ }).getByRole("button", { name: "Chill" }).click();
  await page.getByRole("radiogroup", { name: "How old are you?" }).scrollIntoViewIfNeeded();
  await kit.shot(page, "create-age-mood", w);
  await page.getByRole("button", { name: "Save my card" }).filter({ visible: true }).first().click();
  await page.getByTestId("location-ask").waitFor();
  await kit.shot(page, "create-location-ask", w);
  await ctx.close();
}

async function tooYoung(kit: ShotKit, w: number) {
  const ctx = await kit.context(w);
  const page = await ctx.newPage();
  await page.goto("/create");
  await pickThree(page);
  await page.getByRole("button", { name: "I'm younger" }).click();
  await page.getByRole("heading", { name: "Thanks for stopping by!" }).waitFor();
  await kit.shot(page, "create-too-young", w);
  await ctx.close();
}

async function talkTasteSignals(kit: ShotKit, w: number) {
  const ctx = await kit.context(w, seed);
  const page = await ctx.newPage();
  await page.route("**/api/larry", (r) => r.fulfill({ contentType: "application/x-ndjson", body: ndjson([done({ messages: [{ from: "larry", text: OPENER }] })]) }));
  await page.goto("/larry");
  await page.getByText(OPENER).first().waitFor();
  await page.getByRole("button", { name: "Pick a mood" }).click();
  await page.getByRole("switch", { name: /Hidden gems only/ }).click();
  await kit.shot(page, "talk-taste-signals", w);
  await ctx.close();
}

async function micListening(kit: ShotKit, w: number) {
  const ctx = await kit.context(w, seed);
  // A plain string: tsx wraps functions with helpers (__name) that would not exist in the page.
  // Newer Chromium has the unprefixed name too, so both point at the fake.
  await ctx.addInitScript({
    content: `
      function FakeRec() { this.lang = ""; this.onresult = null; this.onend = null; this.onerror = null; }
      FakeRec.prototype.start = function () { window.__rec = this; };
      FakeRec.prototype.stop = function () { if (this.onend) this.onend(); };
      FakeRec.prototype.abort = function () {};
      window.SpeechRecognition = FakeRec;
      window.webkitSpeechRecognition = FakeRec;
    `,
  });
  const page = await ctx.newPage();
  await page.route("**/api/larry", (r) => r.fulfill({ contentType: "application/x-ndjson", body: ndjson([done({ messages: [{ from: "larry", text: OPENER }] })]) }));
  await page.goto("/larry");
  await page.getByText(OPENER).first().waitFor();
  await page.getByRole("button", { name: "Speak instead of typing" }).click();
  await page.evaluate(
    `window.__rec.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: "I like board games and" }], { isFinal: false })] })`,
  );
  await kit.shot(page, "composer-listening", w);
  await ctx.close();
}

async function micUnsupported(kit: ShotKit, w: number) {
  const ctx = await kit.context(w, seed);
  await ctx.addInitScript(() => {
    const win = window as unknown as Record<string, unknown>;
    delete win.SpeechRecognition;
    delete win.webkitSpeechRecognition;
  });
  const page = await ctx.newPage();
  await page.route("**/api/larry", (r) => r.fulfill({ contentType: "application/x-ndjson", body: ndjson([done({ messages: [{ from: "larry", text: OPENER }] })]) }));
  await page.goto("/larry");
  await page.getByText("Open in Chrome or Safari to use the mic.").waitFor();
  await kit.shot(page, "composer-mic-unsupported", w);
  await ctx.close();
}

async function pairGems(kit: ShotKit, w: number) {
  const ctx = await kit.context(w, { "larry.ageBucket": JSON.stringify("18-24") });
  const page = await ctx.newPage();
  await page.route("**/api/common-ground", (r) =>
    r.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        shared: [],
        bridges: [
          { id: "B1A2C3D4-0000-4000-8000-000000000001", name: "Wolfwalkers", domain: "movie", affinity: 0.8, why: "Hand-drawn and gentle, like Spirited Away.", fromA: ["Spirited Away"], fromB: ["Little Women"] },
          { id: "B1A2C3D4-0000-4000-8000-000000000002", name: "A Short Hike", domain: "videogame", affinity: 0.7, why: "A tiny, cosy island to wander.", fromA: ["Minecraft"], fromB: ["Little Women"] },
        ],
      }),
    }),
  );
  await page.route("**/api/chat", (r) =>
    r.fulfill({ contentType: "application/x-ndjson", body: ndjson([done({ messages: [{ from: "larry", text: "Hi Sam and Priya. Wolfwalkers might suit you both. Priya, seen it?" }] })]) }),
  );
  await page.goto(`/pair?a=${encodeProfile(SAM)}&b=${encodeProfile(PRIYA)}&owner=b`);
  await page.getByText("Wolfwalkers might suit you both", { exact: false }).first().waitFor();
  await page.getByRole("switch", { name: /Hidden gems only/ }).click();
  await page.getByText("Hidden gem", { exact: true }).first().waitFor();
  await kit.shot(page, "pair-hidden-gems", w);
  await ctx.close();
}

async function roomCode(kit: ShotKit, w: number) {
  const ctx = await kit.context(w);
  const page = await ctx.newPage();
  await page.goto("/room");
  await page.getByLabel("Room code").fill("larry o0i1ab");
  await page.getByRole("button", { name: "Join" }).click();
  await page.locator("form").getByRole("alert").waitFor();
  await kit.shot(page, "room-code-hint", w);
  await ctx.close();
}

export const jobs: ShotJob[] = [
  { name: "create-age", run: createAge },
  { name: "too-young", run: tooYoung },
  { name: "talk-taste-signals", run: talkTasteSignals },
  { name: "mic-listening", run: micListening },
  { name: "mic-unsupported", run: micUnsupported },
  { name: "pair-gems", run: pairGems },
  { name: "room-code", run: roomCode },
];
