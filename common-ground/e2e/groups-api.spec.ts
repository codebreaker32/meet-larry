import type { APIRequestContext } from "@playwright/test";
import type { GroupCreateResponse, GroupJoinResponse, GroupMessageView, GroupPollResponse, GroupPreviewResponse } from "../src/lib/groups/shared";
import { bearer, expect, freshIp, larryHeader, test } from "./fixtures";
import { PRIYA, SAM } from "./helpers";

// 2B server: the group routes end to end on the in-memory database, three signed-in accounts.
// Group of 3 by QR: preview, join until full (a fourth is turned away), Larry opens with common
// ground (bridges naming whose picks led there, under 90 words), untagged lines get no reply, a
// /command does, a phone number makes Larry step in warmly, members are friends, unfriend ends it.
// Qloo is the dev-only fake (x-e2e-fake-qloo) and the model never runs (x-e2e-larry).

const ALEX = { ...PRIYA, name: "Alex" };

async function account(request: APIRequestContext, name: string) {
  const uid = `g2b-${name.toLowerCase()}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;
  const headers = { ...bearer(uid), "x-real-ip": freshIp(), "x-e2e-fake-qloo": "1" };
  const { username } = (await (await request.get("/api/account/username", { headers })).json()) as { username: string };
  expect(username).not.toMatch(/^u\//);
  const made = await request.post("/api/account", { data: { name, username, dob: { d: 2, m: 3, y: 1994 } }, headers });
  expect(made.status(), await made.text()).toBeLessThan(300);
  return { uid, username, headers };
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

async function poll(request: APIRequestContext, id: string, headers: Record<string, string>) {
  const res = await request.get(`/api/groups/${encodeURIComponent(id)}`, { headers });
  expect(res.status(), await res.text()).toBe(200);
  const out = (await res.json()) as GroupPollResponse;
  if ("unchanged" in out) throw new Error("expected a full answer");
  return out;
}

test("groups by QR: join until full, Larry opens with common ground, speaks only when tagged, steps in on a phone number, unfriend ends it", async ({
  request,
}, info) => {
  test.skip(info.project.name === "mobile", "API only; once is enough.");
  test.setTimeout(90_000);
  const sam = await account(request, "Sam");
  const priya = await account(request, "Priya");
  const alex = await account(request, "Alex");
  const late = await account(request, "Late");

  // Signed out: the warm accounts-only line.
  expect((await request.post("/api/groups", { data: { size: 3, profile: SAM } })).status()).toBe(401);
  // Only 2-5.
  expect((await request.post("/api/groups", { data: { size: 6, profile: SAM }, headers: sam.headers })).status()).toBe(400);

  const created = await request.post("/api/groups", { data: { size: 3, profile: SAM }, headers: sam.headers });
  expect(created.status(), await created.text()).toBe(200);
  const { group, join } = (await created.json()) as GroupCreateResponse;
  expect(group.openSeats).toBe(2);
  expect(join.path).toBe(`/scan#t=${join.token}`);
  expect(join.expiresAt - Date.now()).toBeLessThanOrEqual(15 * 60 * 1000);

  const preview = (await (
    await request.post("/api/groups/join", { data: { action: "preview", token: join.token }, headers: priya.headers })
  ).json()) as GroupPreviewResponse;
  expect(preview).toMatchObject({ names: ["Sam"], openSeats: 2, size: 3 });
  // A forged token never works.
  expect((await request.post("/api/groups/join", { data: { action: "join", token: `${join.token}x`, profile: PRIYA }, headers: priya.headers })).status()).toBeGreaterThanOrEqual(400);

  for (const [who, profile] of [
    [priya, PRIYA],
    [alex, ALEX],
  ] as const) {
    const res = await request.post("/api/groups/join", { data: { action: "join", token: join.token, profile }, headers: who.headers });
    expect(res.status(), await res.text()).toBe(200);
  }
  // Full: the QR stops working.
  expect((await request.post("/api/groups/join", { data: { action: "join", token: join.token, profile: PRIYA }, headers: late.headers })).status()).toBeGreaterThanOrEqual(400);
  // Not a member: nothing to read.
  expect((await request.get(`/api/groups/${encodeURIComponent(group.id)}`, { headers: late.headers })).status()).toBe(404);

  // Larry's opening arrives after the response (polled).
  let opening: GroupMessageView | undefined;
  await expect
    .poll(async () => {
      opening = (await poll(request, group.id, sam.headers)).messages.find((m) => m.kind === "opening");
      return !!opening;
    }, { timeout: 20_000 })
    .toBe(true);
  expect(words(opening!.text)).toBeLessThanOrEqual(90);
  expect(opening!.ground?.bridges.length ?? 0).toBeGreaterThan(0);
  // No uid ever leaves the server.
  const raw = JSON.stringify(await poll(request, group.id, priya.headers));
  for (const u of [sam.uid, priya.uid, alex.uid]) expect(raw).not.toContain(u);

  const say = async (headers: Record<string, string>, text: string) => {
    const res = await request.post(`/api/groups/${encodeURIComponent(group.id)}/messages`, {
      data: { text },
      headers: { ...headers, "x-e2e-larry": larryHeader({ text: "Here's a plan for all of you." }) },
    });
    expect(res.status(), await res.text()).toBe(200);
    return (await res.json()) as { messages: GroupMessageView[] };
  };
  const larryCount = (ms: GroupMessageView[]) => ms.filter((m) => m.from === "larry").length;

  // Untagged: Larry stays quiet.
  const before = larryCount((await poll(request, group.id, sam.headers)).messages);
  const quiet = await say(priya.headers, "Saturday works for me");
  expect(larryCount(quiet.messages)).toBe(before);
  // A /command: Larry answers.
  const help = await say(priya.headers, "/help");
  expect(larryCount(help.messages)).toBe(before + 1);
  expect(help.messages.at(-1)!.text).toContain("/plan");
  // A phone number: Larry steps in warmly, without naming anyone.
  const tip = await say(alex.headers, "text me on 98765 43210");
  const care = tip.messages.at(-1)!;
  expect(care.kind).toBe("care");
  expect(care.text).not.toContain("Alex");

  // Members are friends.
  const friends = (await (await request.get("/api/friends", { headers: sam.headers })).json()) as { friends: { username: string }[] };
  expect(friends.friends.map((f) => f.username).sort()).toEqual([alex.username, priya.username].sort());
  // A friend sees a friend profile; a stranger a counts-only one.
  const asFriend = (await (await request.get(`/api/profile/${priya.username}`, { headers: sam.headers })).json()) as { viewer: string };
  expect(asFriend.viewer).toBe("friend");
  const asStranger = (await (await request.get(`/api/profile/${priya.username}`, { headers: late.headers })).json()) as { viewer: string };
  expect(asStranger.viewer).toBe("stranger");

  // Unfriend: silent, immediate, Sam leaves every group shared with Priya.
  expect((await request.post("/api/friends", { data: { action: "unfriend", username: priya.username }, headers: sam.headers })).status()).toBe(200);
  expect((await request.get(`/api/groups/${encodeURIComponent(group.id)}`, { headers: sam.headers })).status()).toBe(404);
  const after = (await (await request.get("/api/friends", { headers: priya.headers })).json()) as { friends: { username: string }[] };
  expect(after.friends.map((f) => f.username)).toEqual([alex.username]);
  // Unknown or not-a-friend: the same quiet ok.
  expect((await request.post("/api/friends", { data: { action: "block", username: "NobodyHere99" }, headers: sam.headers })).status()).toBe(200);
});

test("groups: the creator closes joining and removes someone; leave is silent", async ({ request }, info) => {
  test.skip(info.project.name === "mobile", "API only; once is enough.");
  const sam = await account(request, "Sam");
  const priya = await account(request, "Priya");
  const late = await account(request, "Late");
  const { group, join } = (await (await request.post("/api/groups", { data: { size: 4, profile: SAM }, headers: sam.headers })).json()) as GroupCreateResponse;
  const joined = (await (
    await request.post("/api/groups/join", { data: { action: "join", token: join.token, profile: PRIYA }, headers: priya.headers })
  ).json()) as GroupJoinResponse;
  expect(joined.group.members).toHaveLength(2);

  // Only the creator can close joining.
  expect((await request.post(`/api/groups/${encodeURIComponent(group.id)}/joining`, { data: { action: "close" }, headers: priya.headers })).status()).toBe(403);
  const closed = await request.post(`/api/groups/${encodeURIComponent(group.id)}/joining`, { data: { action: "close" }, headers: sam.headers });
  expect(closed.status(), await closed.text()).toBe(200);
  expect((await request.post("/api/groups/join", { data: { action: "join", token: join.token, profile: PRIYA }, headers: late.headers })).status()).toBeGreaterThanOrEqual(400);

  // Remove Priya: she can no longer read it.
  const view = await poll(request, group.id, sam.headers);
  const priyaId = view.group.members.find((m) => !m.isMe)!.id;
  expect((await request.post(`/api/groups/${encodeURIComponent(group.id)}/members`, { data: { action: "remove", memberId: priyaId }, headers: sam.headers })).status()).toBe(200);
  expect((await request.get(`/api/groups/${encodeURIComponent(group.id)}`, { headers: priya.headers })).status()).toBe(404);

  // Leave.
  expect((await request.post(`/api/groups/${encodeURIComponent(group.id)}/leave`, { headers: sam.headers })).status()).toBe(200);
  const list = (await (await request.get("/api/groups", { headers: sam.headers })).json()) as { groups: unknown[] };
  expect(list.groups).toHaveLength(0);
});
