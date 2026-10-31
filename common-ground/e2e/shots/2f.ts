// 2F review screenshots: Open to meet v2. The signed-out gate, the under-18 note, the switch-on
// screen (exact preview entry plus the "which one is me?" tap), the nearby list with Larry's witty
// lines, and the warm empty venue. Run: `npx tsx e2e/review-shots.ts 2f [job]`. The account and the
// meet answers are mocked at the HTTP boundary; no model, Qloo or AWS call is made.
import type { BrowserContext, Page } from "@playwright/test";
import type { ShotJob, ShotKit } from "./_kit";

const PLACE_ID = "E2E00000-0000-4000-8000-0000000000C1";
const PLACE = "Dice and Tea Board Game Cafe";
const persona = {
  version: 1,
  name: "Sam",
  likes: [
    { id: "875DB771-9C4C-4DD0-9249-D2ABD95711F1", name: "Spirited Away", domain: "movie" },
    { id: "875DB771-9C4C-4DD0-9249-D2ABD95711F2", name: "Stardew Valley", domain: "videogame" },
  ],
  dislikes: [],
  notes: [],
  updatedAt: Date.now(),
};
const account = {
  uid: "e2e-2f-user",
  name: "Sam",
  username: "QuietOtter42",
  createdAt: Date.UTC(2026, 9, 30),
  budgetCentsLeft: 25,
  glory: 30,
  sharingWithFriends: false,
  showOnLeaderboards: false,
  publicTitleCounts: {},
  ageBucket: "25-34",
};
const visit = { placeId: PLACE_ID, placeName: PLACE, visitToken: "e2e.visit.token.0000000000", dwellMs: 1_200_000, arrivedAt: Date.now() - 60_000 };

const signedInSeed = {
  "larry.persona": JSON.stringify(persona),
  "larry.e2e.uid": account.uid,
  "larry.ageBucket": JSON.stringify("25-34"),
  "larry.location.choice": "on",
  "larry.visit": JSON.stringify(visit),
};

const GROUPS = [
  {
    groupId: "g_aaaaaaaaaaaa",
    kind: "pick",
    thing: "Spirited Away",
    count: 2,
    line: "2 people here like Spirited Away too.",
    witty: { line: "A fellow Spirited Away soul is in here somewhere, probably humming the soundtrack.", plain: "Two people here like Spirited Away." },
    waved: false,
  },
  {
    groupId: "g_bbbbbbbbbbbb",
    kind: "bridge",
    thing: "Cozy Grove",
    count: 1,
    line: "Larry thinks you and someone here would both love Cozy Grove.",
    witty: { line: "Somebody nearby would happily swap Cozy Grove tips with you.", plain: "Someone here might like Cozy Grove like you." },
    waved: true,
  },
];

async function mockMeet(ctx: BrowserContext, groups: unknown[]) {
  await ctx.route("**/api/account", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(account) }));
  await ctx.route("**/api/account/sync", (r) => r.fulfill({ contentType: "application/json", body: "{}" }));
  await ctx.route("**/api/meet/**", (r) => {
    const url = r.request().url();
    if (url.endsWith("/open")) return r.fulfill({ contentType: "application/json", body: JSON.stringify({ sessionId: "s".repeat(24), expiresAt: Date.now() + 3 * 3600_000 }) });
    if (url.endsWith("/close")) return r.fulfill({ contentType: "application/json", body: '{"ok":true}' });
    if (r.request().headers()["x-meet-session"])
      return r.fulfill({ contentType: "application/json", body: JSON.stringify({ venue: { name: PLACE }, expiresAt: Date.now() + 3 * 3600_000, groups, matches: [] }) });
    return r.fulfill({ contentType: "application/json", body: JSON.stringify({ venue: { name: PLACE } }) });
  });
}

async function switchedOn(kit: ShotKit, width: number, groups: unknown[]): Promise<Page> {
  const ctx = await kit.context(width, signedInSeed);
  await mockMeet(ctx, groups);
  const page = await ctx.newPage();
  await page.goto(`/meet/${PLACE_ID}`);
  await page.getByLabel("I am 18 or over.").check();
  await page.getByRole("button", { name: "Switch on Open to meet" }).click();
  await page.getByText("Open to meet is on").waitFor();
  return page;
}

export const jobs: ShotJob[] = [
  {
    name: "signed-out",
    async run(kit, width) {
      const ctx = await kit.context(width, { "larry.persona": JSON.stringify(persona), "larry.location.choice": "on" });
      await mockMeet(ctx, []);
      const page = await ctx.newPage();
      await page.goto(`/meet/${PLACE_ID}`);
      await page.getByRole("heading", { name: "Open to meet is for members 18+" }).waitFor();
      await kit.shot(page, "2f-signed-out", width);
      await ctx.close();
    },
  },
  {
    name: "under-18",
    async run(kit, width) {
      const ctx = await kit.context(width, { "larry.persona": JSON.stringify(persona), "larry.ageBucket": JSON.stringify("13-17"), "larry.location.choice": "on" });
      await mockMeet(ctx, []);
      const page = await ctx.newPage();
      await page.goto(`/meet/${PLACE_ID}`);
      await page.getByRole("heading", { name: "Open to meet opens up at 18" }).waitFor();
      await kit.shot(page, "2f-under-18", width);
      await ctx.close();
    },
  },
  {
    name: "switch-on",
    async run(kit, width) {
      const ctx = await kit.context(width, signedInSeed);
      await mockMeet(ctx, []);
      const page = await ctx.newPage();
      await page.goto(`/meet/${PLACE_ID}`);
      await page.getByRole("button", { name: "Could they tell which one is me?" }).click();
      await kit.shot(page, "2f-switch-on", width, true);
      await ctx.close();
    },
  },
  {
    name: "nearby",
    async run(kit, width) {
      const page = await switchedOn(kit, width, GROUPS);
      await page.getByText("A fellow Spirited Away soul").waitFor();
      await kit.shot(page, "2f-nearby", width, true);
      await page.context().close();
    },
  },
  {
    name: "empty",
    async run(kit, width) {
      const page = await switchedOn(kit, width, []);
      await page.getByText("Nobody here shares your taste yet.", { exact: false }).waitFor();
      await kit.shot(page, "2f-empty", width, true);
      await page.context().close();
    },
  },
];


