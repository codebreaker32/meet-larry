// 2G review screenshots: profiles and badges. The three profile views (stranger, friend, owner on /me),
// the 13-badge shelf, a place page with the top 3, and a device-only /me. Run against a dev server
// started with NEXT_PUBLIC_E2E=1 E2E=1 LARRY_DB=memory: `npx tsx e2e/review-shots.ts 2g [job]`.
// The people API is answered with the 0D contract fixtures; no model, Qloo or Amazon call is made.
import type { BrowserContext } from "@playwright/test";
import { CAFE, FRIEND_PROFILE, mockContracts, OWNER_PROFILE, PODIUM, STRANGER_PROFILE } from "../fixtures";
import type { ShotJob } from "./_kit";

const signedIn = { "larry.e2e.uid": "e2e-user-1" };
const counters = JSON.stringify([
  { placeId: CAFE.placeId, placeName: CAFE.placeName, visits: 4, weeksBits: "1111", totalWeeks: 4, lastIsoWeek: "2026-W44", stage: "regular", spotWeeks: 4 },
]);

const owner = {
  ...OWNER_PROFILE,
  glory: 45,
  places: [{ venue: CAFE, stage: "regular" as const, visits: 4, weeks: 4, nextStage: { stage: "veteran" as const, visitsAway: 2 } }],
};

async function mocked(ctx: BrowserContext, opts: Parameters<typeof mockContracts>[1]) {
  await mockContracts(ctx, opts);
  return ctx;
}

export const jobs: ShotJob[] = [
  {
    name: "stranger",
    async run(kit, width) {
      const ctx = await mocked(await kit.context(width), {
        account: null,
        profile: { ...STRANGER_PROFILE, publicTitles: [{ title: "final-boss", places: 2 }, { title: "shogun", places: 1 }] },
      });
      const page = await ctx.newPage();
      await page.goto("/profile/QuietOtter42");
      await page.getByText("at 2 places").waitFor();
      await kit.shot(page, "profile-stranger", width, true);
      await ctx.close();
    },
  },
  {
    name: "friend",
    async run(kit, width) {
      const ctx = await mocked(await kit.context(width, signedIn), { profile: { ...FRIEND_PROFILE, username: "BraveHeron31", displayName: "Priya" } });
      const page = await ctx.newPage();
      await page.goto("/profile/BraveHeron31");
      await page.locator("main").getByText("Party Leader", { exact: true }).first().waitFor();
      await kit.shot(page, "profile-friend", width, true);
      await ctx.close();
    },
  },
  {
    name: "owner",
    async run(kit, width) {
      const ctx = await mocked(await kit.context(width, { ...signedIn, "larry.places": counters, "larry.glory": "45" }), { profile: owner });
      const page = await ctx.newPage();
      await page.goto("/me");
      await page.getByRole("list", { name: "Your badges" }).waitFor();
      await kit.shot(page, "profile-owner", width, true);
      await page.getByRole("button", { name: /Final Boss.*What does this mean/ }).first().click();
      await page.getByRole("dialog").waitFor();
      await kit.shot(page, "badge-sheet", width);
      await ctx.close();
    },
  },
  {
    name: "place",
    async run(kit, width) {
      const ctx = await mocked(await kit.context(width, { "larry.places": counters }), { account: null, podium: PODIUM });
      const page = await ctx.newPage();
      await page.goto(`/place/${CAFE.placeId}?name=${encodeURIComponent(CAFE.placeName)}`);
      await page.locator("[data-podium-row]").first().waitFor();
      await kit.shot(page, "place-podium", width, true);
      await ctx.close();
    },
  },
  {
    name: "device",
    async run(kit, width) {
      const ctx = await mocked(await kit.context(width, { "larry.places": counters, "larry.glory": "45" }), { account: null });
      const page = await ctx.newPage();
      await page.goto("/me");
      await page.getByRole("heading", { name: "Your progress" }).waitFor();
      await kit.shot(page, "me-device-only", width, true);
      await ctx.close();
    },
  },
];
