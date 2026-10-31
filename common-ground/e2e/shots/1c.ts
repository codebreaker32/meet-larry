// 1C Qloo signals (server): what the signals change on screen. Not a test.
// Run with `npx tsx e2e/review-shots.ts 1c [job]`. Every model and Qloo call is mocked at the
// HTTP boundary, with the shapes the 1C server now sends: a low-energy Talk taste reply, places with
// specific fit lines (no devotional shop, no repeats), and a two-stop Plan Ticket with a real time.
import type { PlaceCard, PlanTicket } from "../../src/lib/contracts";
import { DEMO_SAM as SAM } from "../../src/lib/demo";
import type { ShotJob, ShotKit } from "./_kit";

const persona = {
  version: 1,
  name: "Sam",
  likes: SAM.items,
  dislikes: [],
  notes: ["likes board games with a few friends"],
  placeVibe: "calm",
  updatedAt: Date.now(),
};
// The device holds mood, age range and Hidden Gems; they go only with Sam's own requests.
const seed = {
  "larry.persona": JSON.stringify(persona),
  "larry.mood": JSON.stringify("low-energy"),
  "larry.ageBucket": JSON.stringify("18-24"),
  "larry.hiddenGems": JSON.stringify(true),
};

const dice: PlaceCard = {
  id: "E2E00000-0000-4000-8000-0000000001C1",
  name: "Dice & Tea Board Game Café",
  distanceKm: 0.6,
  tags: ["Board games", "Quiet"],
  affinity: 0.9,
  vibe: "calm",
  hours: "Mon-Fri 10am-8pm, Sat-Sun 9am-9pm",
  slots: ["Sat 11am", "Sun 2pm"],
  fits: [{ who: "me", likely: "likes", why: "Board games, and it goes with Minecraft." }],
};
const books: PlaceCard = {
  id: "E2E00000-0000-4000-8000-0000000001C2",
  name: "Title Waves Books",
  distanceKm: 0.8,
  tags: ["Books"],
  affinity: 0.8,
  vibe: "cosy",
  hours: "Daily 10am-7pm",
  slots: ["Sat 11am"],
  fits: [{ who: "me", likely: "likes", why: "Books, and it goes with Spirited Away." }],
};
const ticket: PlanTicket & { then: { place: PlaceCard; walkMin: number; todo: string } } = {
  place: dice,
  when: "Sat 11am",
  item: { id: "875DB771-9C4C-4DD0-9249-D2ABD95711F1", name: "Stardew Valley", domain: "videogame" },
  opener: "Have you played Stardew Valley?",
  todo: "Play one short round of a farming board game.",
  planB: "If it's too busy, go to Title Waves Books instead (0.8 km).",
  rung: 0,
  mood: "low-energy",
  then: { place: books, walkMin: 6, todo: "Browse the Ghibli art books for ten minutes." },
};

const ndjson = (events: unknown[]) => events.map((e) => JSON.stringify(e)).join("\n") + "\n";
const done = (result: Record<string, unknown>) => ({ type: "done", result: { messages: [], quiet: false, steps: [], profileUpdates: [], ...result } });

async function talkLowEnergy(kit: ShotKit, w: number) {
  const ctx = await kit.context(w, seed);
  const page = await ctx.newPage();
  let n = 0;
  await page.route("**/api/larry", (r) => {
    const events =
      n++ === 0
        ? [done({ messages: [{ from: "larry", text: "Hi Sam, I'm Larry, an AI. Want one small, easy plan for this week?" }] })]
        : [
            done({
              messages: [{ from: "larry", text: "Gentle one: a quiet board-game café on Saturday, then a short walk to books if you feel like it." }],
              places: [dice, books],
              planTicket: ticket,
            }),
          ];
    return r.fulfill({ contentType: "application/x-ndjson", body: ndjson(events) });
  });
  await page.goto("/larry");
  await page.getByText("Want one small, easy plan").first().waitFor();
  const box = page.getByRole("textbox").first();
  await box.fill("Yes, something easy.");
  await box.press("Enter");
  await page.getByText("Gentle one").first().waitFor();
  await page.waitForLoadState("networkidle").catch(() => {});
  await kit.shot(page, "talk-low-energy", w);
  const plan = page.getByRole("button", { name: "See the plan" }).first();
  if (await plan.isVisible().catch(() => false)) {
    await plan.click();
    await page.getByRole("region", { name: "Your plan" }).waitFor().catch(() => {});
    await kit.shot(page, "two-stop-ticket", w, true);
  }
  await ctx.close();
}

export const jobs: ShotJob[] = [{ name: "talk", run: talkLowEnergy }];
