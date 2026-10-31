// 2B review screenshots: what the group server puts on screen. Real group routes on the in-memory
// database (run the server with NEXT_PUBLIC_E2E=1 E2E=1 LARRY_DB=memory): three accounts make a
// group of 3 by QR, Larry opens it with Qloo common ground ("Why this?"), a line with no tag gets no
// reply, /help gets the menu, a phone number gets Larry's warm step-in; then a friend's and a
// stranger's view of a profile. Qloo is the dev-only fake (x-e2e-fake-qloo); no model or AWS call.
// Run: `npx tsx e2e/review-shots.ts 2b [job]`.
import type { APIRequestContext } from "@playwright/test";
import { DEMO_PRIYA, DEMO_SAM } from "../../src/lib/demo";
import type { GroupCreateResponse, GroupPollResponse } from "../../src/lib/groups/shared";
import type { ShotJob, ShotKit } from "./_kit";

const FAKE = { "x-e2e-fake-qloo": "1" };

async function account(api: APIRequestContext, name: string) {
  const uid = `shot-2b-${name.toLowerCase()}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;
  const headers = { authorization: `Bearer e2e:${uid}`, ...FAKE };
  const { username } = (await (await api.get("/api/account/username", { headers })).json()) as { username: string };
  await api.post("/api/account", { data: { name, username, dob: { d: 2, m: 3, y: 1994 } }, headers });
  return { uid, username, headers };
}

/** A formed group of 3 with Larry's opening and a few lines, seen by Sam on the group screen. */
async function formedGroup(kit: ShotKit, width: number) {
  const ctx = await kit.context(width, {}, FAKE);
  const api = ctx.request;
  const sam = await account(api, "Sam");
  const priya = await account(api, "Priya");
  const alex = await account(api, "Alex");
  const { group, join } = (await (await api.post("/api/groups", { data: { size: 3, profile: DEMO_SAM }, headers: sam.headers })).json()) as GroupCreateResponse;
  await api.post("/api/groups/join", { data: { action: "join", token: join.token, profile: DEMO_PRIYA }, headers: priya.headers });
  await api.post("/api/groups/join", { data: { action: "join", token: join.token, profile: { ...DEMO_PRIYA, name: "Alex" } }, headers: alex.headers });
  const url = `/api/groups/${encodeURIComponent(group.id)}`;
  for (let i = 0; i < 40; i++) {
    const out = (await (await api.get(url, { headers: sam.headers })).json()) as GroupPollResponse;
    if (!("unchanged" in out) && out.messages.some((m) => m.kind === "opening")) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const say = (headers: Record<string, string>, text: string) => api.post(`${url}/messages`, { data: { text }, headers });
  await say(priya.headers, "Saturday works for me");
  await say(alex.headers, "/help");
  await say(alex.headers, "text me on 98765 43210");
  await ctx.addInitScript((id) => {
    localStorage.setItem("larry.e2e.uid", id);
    localStorage.setItem("larry.location.choice", "off");
  }, sam.uid);
  const page = await ctx.newPage();
  return { ctx, page, group, sam, priya };
}

export const jobs: ShotJob[] = [
  {
    name: "group-chat",
    async run(kit, width) {
      const { ctx, page, group } = await formedGroup(kit, width);
      await page.goto(`/group/${encodeURIComponent(group.id)}`);
      await page.getByText("Quick tip from Larry").waitFor({ timeout: 30_000 }).catch(() => undefined);
      await kit.shot(page, "group-chat", width, true);
      await ctx.close();
    },
  },
  {
    name: "profile-views",
    async run(kit, width) {
      const { ctx, page, priya } = await formedGroup(kit, width);
      await page.goto(`/u/${priya.username}`);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await kit.shot(page, "profile-as-friend", width, true);
      const stranger = await kit.context(width);
      const sp = await stranger.newPage();
      await sp.goto(`/u/${priya.username}`);
      await sp.waitForLoadState("networkidle").catch(() => undefined);
      await kit.shot(sp, "profile-as-stranger", width, true);
      await stranger.close();
      await ctx.close();
    },
  },
];
