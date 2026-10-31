// 2A review screenshots: the landing (friends-first calls to action, original hero) and Larry's
// next-move popup (signed in) through the journey: Fingerprint, start a group, plan reminder with the
// opener, check-in with title progress, this month's quest, and a verified Match Day.
// Run: `npx tsx e2e/review-shots.ts 2a [job]`. /api/witty and /api/matchday are mocked; no model or Qloo call.
import type { BrowserContext, Page } from "@playwright/test";
import type { ShotJob, ShotKit } from "./_kit";

const PLACE_ID = "E2E00000-0000-4000-8000-0000000000C1";
const PLACE = "Dice and Tea Board Game Cafe";
const STARDEW = { id: "875DB771-9C4C-4DD0-9249-D2ABD95711F1", name: "Stardew Valley", domain: "videogame" };
const MI = { id: "E2E0TEAM-0000-4000-8000-00000000000A", name: "Mumbai Indians", domain: "sports_team" };
const persona = (likes: object[] = [STARDEW]) => JSON.stringify({ version: 1, name: "Sam", likes, dislikes: [], notes: [], placeVibe: "calm" });
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function week(d = new Date()): string {
  const day = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (new Date(day).getUTCDay() + 6) % 7;
  const th = new Date(day + (3 - dow) * 864e5);
  const jan1 = Date.UTC(th.getUTCFullYear(), 0, 1);
  return `${th.getUTCFullYear()}-W${String(Math.floor((th.getTime() - jan1) / 864e5 / 7) + 1).padStart(2, "0")}`;
}
const counters = (visits: number) =>
  JSON.stringify([{ placeId: PLACE_ID, placeName: PLACE, visits, weeksBits: "1", totalWeeks: 1, lastIsoWeek: week(), stage: "rookie", spotWeeks: 1 }]);
const plan = (when: string) =>
  JSON.stringify([
    { id: "p1", kind: "go", text: `Go to ${PLACE}.`, createdAt: Date.now() - 1000, done: false, placeId: PLACE_ID, placeName: PLACE, when, opener: "Have you ever tried Stardew Valley?", withPerson: "Priya" },
  ]);
const ADULT = { "larry.ageBucket": JSON.stringify("25-34"), "larry.fingerprint.seen": "true" };

async function quiet(ctx: BrowserContext, matchDay = false) {
  await ctx.route("**/api/witty", (r) => r.fulfill({ status: 404, body: "{}" }));
  await ctx.route("**/api/matchday**", (r) =>
    r.fulfill({
      contentType: "application/json",
      body: JSON.stringify(matchDay ? { matchDays: [{ team: "Mumbai Indians", league: "IPL", fixture: { teams: "MI v CSK", when: "Sun 7:30pm" }, source: "Example fixture (screenshot only)" }] } : { matchDays: [] }),
    }),
  );
}

/** A real signed-in 18+ account (fake e2e token, in-memory database) on this context. */
async function signIn(ctx: BrowserContext, page: Page) {
  const uid = `shot2a-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;
  const auth = { authorization: `Bearer e2e:${uid}` };
  await ctx.addInitScript((id) => localStorage.setItem("larry.e2e.uid", id), uid);
  const { username } = (await (await page.request.get("/api/account/username", { headers: auth })).json()) as { username: string };
  await page.request.post("/api/account", { data: { name: "Sam", username, dob: { d: 2, m: 3, y: 1994 } }, headers: auth });
}

/** Home. With a seed the person is signed in, so Larry's next move opens as a popup by itself. */
async function home(kit: ShotKit, w: number, seed: Record<string, string>, matchDay = false): Promise<Page> {
  const ctx = await kit.context(w, seed);
  await quiet(ctx, matchDay);
  const page = await ctx.newPage();
  if (Object.keys(seed).length) await signIn(ctx, page);
  await page.goto("/");
  if (Object.keys(seed).length) await page.getByTestId("next-move").waitFor({ timeout: 30_000 });
  return page;
}

const job = (name: string, seed: Record<string, string>, matchDay = false): ShotJob => ({
  name,
  async run(kit, w) {
    const page = await home(kit, w, seed, matchDay);
    await kit.shot(page, `2a-${name}`, w);
    if (name === "home-group") {
      // Under the popup: the signed-in home buttons.
      await page.keyboard.press("Escape");
      await kit.shot(page, "2a-home-under-popup", w);
    }
    await page.context().close();
  },
});

export const jobs: ShotJob[] = [
  job("landing", {}),
  job("home-fingerprint", { "larry.persona": persona(), "larry.ageBucket": JSON.stringify("25-34") }),
  job("home-group", { "larry.persona": persona(), ...ADULT }),
  job("home-reminder", { "larry.persona": persona(), ...ADULT, "cg.steps": plan(`${DAYS[(new Date().getDay() + 2) % 7]} 11am`) }),
  job("home-checkin", { "larry.persona": persona(), ...ADULT, "cg.steps": plan("Today 4pm"), "larry.places": counters(1) }),
  job("home-quest", { "larry.persona": persona(), ...ADULT, "cg.steps": "[]", "larry.places": counters(3), "larry.groups.met": "1" }),
  job("home-matchday", { "larry.persona": persona([STARDEW, MI]), ...ADULT, "cg.steps": "[]", "larry.places": counters(2), "larry.groups.met": "1" }, true),
];
