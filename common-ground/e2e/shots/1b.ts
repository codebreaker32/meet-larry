// 1B review screenshots: check-in v2 on /steps. The idle sheet, the calm "while there" card, the
// warm "not at the place yet" and "closed right now" refusals, "That was quick!", the counted
// result (stage stamp, Glory, Guess vs Reality, Larry's line, the repeat offer) and the private
// places collection. Run: `npx tsx e2e/review-shots.ts 1b [job]`. Check-in and playback answers
// are mocked at the HTTP boundary; no model, Qloo or Amazon call is made.
import type { BrowserContext, Page } from "@playwright/test";
import type { ShotJob, ShotKit } from "./_kit";

const PLACE_ID = "E2E00000-0000-4000-8000-0000000000C1";
const PLACE = "Dice and Tea Board Game Cafe";
const persona = {
  version: 1,
  name: "Sam",
  likes: [{ id: "875DB771-9C4C-4DD0-9249-D2ABD95711F1", name: "Stardew Valley", domain: "videogame" }],
  dislikes: [],
  notes: [],
  placeVibe: "calm",
  updatedAt: Date.now(),
};
const step = {
  id: "plan1",
  kind: "go",
  text: `Go to ${PLACE}, Sat 11am.`,
  createdAt: Date.now() - 60_000,
  done: false,
  placeId: PLACE_ID,
  placeName: PLACE,
  vibe: "calm",
  opener: "Have you played Stardew Valley?",
  planB: "If it's too busy, I'll come back on a weekday.",
  guess: 2,
};
const counters = [
  { placeId: PLACE_ID, placeName: PLACE, visits: 2, weeksBits: "11", totalWeeks: 2, lastIsoWeek: "2026-W43", stage: "rookie", spotWeeks: 2 },
  { placeId: "E2E00000-0000-4000-8000-0000000000C2", placeName: "Title Waves Books", visits: 0, weeksBits: "", totalWeeks: 0, lastIsoWeek: "2026-W43", stage: null, spotWeeks: 0, unverified: 1 },
];
const seed = (extra: Record<string, string> = {}) => ({
  "larry.persona": JSON.stringify(persona),
  "cg.steps": JSON.stringify([step]),
  "larry.location": JSON.stringify({ lat: 19.08, lon: 72.88, at: Date.now() }),
  "larry.location.choice": "on",
  ...extra,
});

async function mocks(ctx: BrowserContext, arrive: { status: number; body: unknown }, leave: unknown) {
  await ctx.route("**/api/places", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ places: [] }) }));
  await ctx.route("**/api/checkins/arrive", (r) => r.fulfill({ status: arrive.status, contentType: "application/json", body: JSON.stringify(arrive.body) }));
  await ctx.route("**/api/checkins/leave", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(leave) }));
  await ctx.route("**/api/checkins/playback", (r) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify({ line: "Dice and Tea now has a Regular. The board games approve.", plain: "You're a Regular now.", source: "model" }) }),
  );
}

const OK_ARRIVE = { status: 200, body: { visitToken: "shot.visit.token0000000000", dwellMs: 20 * 60_000 } };

async function open(kit: ShotKit, width: number, arrive: { status: number; body: unknown } = OK_ARRIVE, leave: unknown = { verified: true, gloryDelta: 10 }, extra: Record<string, string> = {}): Promise<Page> {
  const ctx = await kit.context(width, seed({ "larry.places": JSON.stringify(counters), ...extra }));
  await mocks(ctx, arrive, leave);
  const page = await ctx.newPage();
  await page.goto("/steps");
  await page.getByRole("button", { name: `I'm here: ${PLACE}` }).first().click();
  return page;
}

export const jobs: ShotJob[] = [
  {
    name: "idle",
    async run(kit, w) {
      const page = await open(kit, w);
      await kit.shot(page, "1b-checkin-idle", w);
      await page.context().close();
    },
  },
  {
    name: "here",
    async run(kit, w) {
      const page = await open(kit, w);
      await page.getByRole("button", { name: "I'm here", exact: true }).click();
      await page.getByRole("region", { name: `You're at ${PLACE}. Enjoy it.` }).waitFor();
      await kit.shot(page, "1b-checkin-here", w, true);
      await page.context().close();
    },
  },
  {
    name: "too-far",
    async run(kit, w) {
      const page = await open(kit, w, { status: 422, body: { reason: "too-far", error: "x" } });
      await page.getByRole("button", { name: "I'm here", exact: true }).click();
      await page.getByRole("region", { name: "Not yet" }).waitFor();
      await kit.shot(page, "1b-checkin-too-far", w);
      await page.context().close();
    },
  },
  {
    name: "closed",
    async run(kit, w) {
      const page = await open(kit, w, { status: 422, body: { reason: "closed", error: "x" } });
      await page.getByRole("button", { name: "I'm here", exact: true }).click();
      await page.getByRole("region", { name: "Not yet" }).waitFor();
      await kit.shot(page, "1b-checkin-closed", w);
      await page.context().close();
    },
  },
  {
    name: "too-soon",
    async run(kit, w) {
      const page = await open(kit, w, OK_ARRIVE, { verified: false, reason: "too-soon", gloryDelta: 0 });
      await page.getByRole("button", { name: "I'm here", exact: true }).click();
      await page.getByRole("button", { name: "I'm heading off" }).click();
      await page.getByRole("region", { name: "That was quick!" }).waitFor();
      await kit.shot(page, "1b-checkin-too-soon", w);
      await page.context().close();
    },
  },
  {
    name: "counted",
    async run(kit, w) {
      const page = await open(kit, w);
      await page.getByRole("button", { name: "I'm here", exact: true }).click();
      await page.getByRole("button", { name: "I said hi" }).click();
      await page.getByRole("button", { name: "I'm heading off" }).click();
      const counted = page.getByRole("region", { name: /^Counted\./ });
      await counted.waitFor();
      await kit.shot(page, "1b-checkin-counted", w, true);
      await counted.getByRole("radio", { name: "Good" }).click();
      await counted.getByRole("button", { name: "Yes" }).click();
      await counted.getByRole("button", { name: "Done" }).click();
      await counted.getByText(/The board games approve/).waitFor();
      await kit.shot(page, "1b-checkin-larry", w, true);
      await page.context().close();
    },
  },
  {
    name: "places",
    async run(kit, w) {
      const ctx = await kit.context(w, seed({ "larry.places": JSON.stringify(counters), "larry.glory": "25" }));
      await mocks(ctx, OK_ARRIVE, { verified: true, gloryDelta: 0 });
      const page = await ctx.newPage();
      await page.goto("/steps");
      await page.getByRole("region", { name: "Your places" }).scrollIntoViewIfNeeded();
      await kit.shot(page, "1b-places-collection", w, true);
      await ctx.close();
    },
  },
];
