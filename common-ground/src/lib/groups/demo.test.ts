import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "@/lib/types";
import type { Session } from "@/lib/types/account";

// Demo friends for judges: memory repo, no Qloo or model call (the ground finder is a stand-in that
// fails, so openings use the fixed opener and no ground).
vi.mock("@/lib/qloo", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  findGroupCommonGround: vi.fn(async () => {
    throw new Error("no Qloo in unit tests");
  }),
}));

const { createMemoryRepo } = await import("@/lib/db/memory");
const demo = await import("./demo");
const svc = await import("./service");
const { GROUP_COPY } = await import("./shared");
type Repo = import("@/lib/db").Repo;

const NO_QLOO = { find: async () => Promise.reject(new Error("no Qloo")), fixedOpener: true } as const;
const DEMO_UID = "demoAccountUid0000000000001";
const REAL_UID = "realPersonUid00000000000001";
const demoSession: Session = { uid: DEMO_UID, isAdult: true, isDemo: true };
const realSession: Session = { uid: REAL_UID, isAdult: true, isDemo: false };
const card = (name: string): Profile => ({ name, items: [{ id: "CDBDE254-71F0-4640-8D04-5373BEAE5278", name: "Minecraft", domain: "videogame" }] });

async function account(repo: Repo, uid: string, name: string) {
  await repo.accounts.create({
    uid,
    name,
    username: `${name}Otter1`,
    createdAt: 0,
    budgetCentsLeft: 25,
    glory: 0,
    sharingWithFriends: false,
    showOnLeaderboards: false,
    publicTitleCounts: {},
    dob: { d: 1, m: 1, y: 1990 },
  });
}

let repo: Repo;
beforeEach(async () => {
  repo = createMemoryRepo();
  await account(repo, DEMO_UID, "Demo");
  await account(repo, REAL_UID, "Priya");
});

describe("the demo friends", () => {
  it("are five made-up people with distinct taste cards of real Qloo ids", () => {
    expect(demo.DEMO_FRIENDS).toHaveLength(5);
    expect(new Set(demo.DEMO_FRIENDS.map((f) => f.name)).size).toBe(5);
    const cards = demo.DEMO_FRIENDS.map((f) => f.profile.items.map((i) => i.id).sort().join());
    expect(new Set(cards).size).toBe(5);
    for (const f of demo.DEMO_FRIENDS) {
      expect(f.profile.items.length).toBeGreaterThanOrEqual(3);
      for (const i of f.profile.items) expect(i.id).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/);
      expect(f.reply).toMatch(/demo friend/i);
      expect(f.reply).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    }
    // Each card spans more than one kind of taste.
    for (const f of demo.DEMO_FRIENDS) expect(new Set(f.profile.items.map((i) => i.domain)).size).toBeGreaterThan(1);
  });

  it("get accounts once: flagged, no Larry time, off every leaderboard and not sharing", async () => {
    await demo.ensureDemoFriends(repo);
    await demo.ensureDemoFriends(repo);
    for (const f of demo.DEMO_FRIENDS) {
      const a = await repo.accounts.get(demo.demoFriendUid(f.key));
      expect(a).toMatchObject({ name: f.name, isDemoFriend: true, showOnLeaderboards: false, sharingWithFriends: false, budgetCentsLeft: 0, glory: 0 });
      expect(await repo.usernames.owner(a!.username)).toBe(demo.demoFriendUid(f.key));
      expect(await demo.isDemoFriendUid(repo, demo.demoFriendUid(f.key))).toBe(true);
    }
    expect(await demo.isDemoFriendUid(repo, REAL_UID)).toBe(false);
  });
});

describe("seeding the demo account", () => {
  it("makes a 2-person and a 4-person group, each opened by Larry, then one labelled demo-friend line", async () => {
    const out = await demo.seedDemoWorld(repo, DEMO_UID, { opening: NO_QLOO });
    expect(out).toEqual({ made: 2, opened: 2, already: false });
    const sizes = [];
    for (const s of demo.DEMO_GROUPS) {
      const id = demo.demoGroupId(DEMO_UID, s.slot);
      const g = (await repo.groups.get(id))!;
      sizes.push(g.size);
      expect(g.members).toHaveLength(g.size);
      expect(g.creator).toBe(DEMO_UID);
      expect(g.members.filter((m) => m.isDemoFriend)).toHaveLength(g.size - 1);
      const lines = await repo.groupMessages.list(id, { sinceAt: 0, limit: 10 });
      expect(lines[0]).toMatchObject({ from: "larry", kind: "opening" });
      expect(lines[1].kind).toBe("person");
      expect(lines[1].text).toMatch(/demo friend/i);
      expect(lines).toHaveLength(2);

      const view = await svc.readGroup(DEMO_UID, id, {}, repo);
      if ("unchanged" in view) throw new Error("expected a group");
      expect(view.group.opened).toBe(true);
      for (const m of view.group.members) expect(!!m.isDemoFriend).toBe(!m.isMe);
    }
    expect(sizes.sort()).toEqual([2, 4]);
    const list = await svc.listGroups(DEMO_UID, repo);
    expect(list).toHaveLength(2);
    for (const g of list) for (const n of g.names) expect(n).toMatch(/\(Demo friend\)$/);
  });

  it("is idempotent, and --reset-groups seeds them fresh", async () => {
    await demo.seedDemoWorld(repo, DEMO_UID, { opening: NO_QLOO });
    expect(await demo.seedDemoWorld(repo, DEMO_UID, { opening: NO_QLOO })).toEqual({ made: 0, opened: 0, already: true });
    expect(await demo.demoNeedsSeed(repo, DEMO_UID)).toBe(false);
    // Running openings twice never posts a second opening or a second line.
    expect(await demo.openDemoGroups(repo, DEMO_UID, NO_QLOO)).toBe(0);
    const id = demo.demoGroupId(DEMO_UID, "pair");
    expect(await repo.groupMessages.list(id, { sinceAt: 0, limit: 10 })).toHaveLength(2);
    expect(await demo.seedDemoWorld(repo, DEMO_UID, { opening: NO_QLOO, reset: true })).toEqual({ made: 2, opened: 2, already: false });
    expect(await repo.groupMessages.list(id, { sinceAt: 0, limit: 10 })).toHaveLength(2);
  });

  it("can make the groups first and open them later (the lazy path)", async () => {
    expect(await demo.seedDemoWorld(repo, DEMO_UID, { open: false })).toEqual({ made: 2, opened: 0, already: false });
    const g = (await repo.groups.get(demo.demoGroupId(DEMO_UID, "four")))!;
    expect(svc.needsOpening(g)).toBe(true);
    expect(await demo.openDemoGroups(repo, DEMO_UID, NO_QLOO)).toBe(2);
  });

  it("needs the demo account to exist", async () => {
    await expect(demo.seedDemoWorld(repo, "nobody", { opening: NO_QLOO })).rejects.toThrow();
  });
});

describe("demo friends never mix with real people", () => {
  it("a real person can't join a group that has a demo friend", async () => {
    const { group, join } = await svc.createGroup(DEMO_UID, { size: 3, profile: card("Demo") }, repo);
    await demo.demoFriendScan(repo, demoSession, group.id, "tara");
    await expect(svc.joinGroup(REAL_UID, { token: join.token, profile: card("Priya") }, repo)).rejects.toMatchObject({ status: 410, message: GROUP_COPY.qrClosed });
  });

  it("a group left with only demo friends is deleted", async () => {
    await demo.seedDemoWorld(repo, DEMO_UID, { opening: NO_QLOO });
    const id = demo.demoGroupId(DEMO_UID, "four");
    await svc.leaveGroup(DEMO_UID, id, repo);
    expect(await repo.groups.get(id)).toBeNull();
    for (const key of ["mira", "arjun", "rafa"] as const) expect(await repo.groups.listFor(demo.demoFriendUid(key))).toHaveLength(0);
  });

  it("unfriending a demo friend in a one-to-one removes the group", async () => {
    await demo.seedDemoWorld(repo, DEMO_UID, { opening: NO_QLOO });
    await svc.unfriend(DEMO_UID, demo.demoFriendUid("hana"), repo);
    expect(await repo.groups.get(demo.demoGroupId(DEMO_UID, "pair"))).toBeNull();
  });
});

describe("Let a demo friend scan it", () => {
  it("answers only the demo account that started the group, while its QR is live", async () => {
    const { group } = await svc.createGroup(DEMO_UID, { size: 3, profile: card("Demo") }, repo);
    const options = await demo.demoFriendOptions(repo, demoSession, group.id);
    expect(options.map((o) => o.key)).toEqual(["mira", "arjun", "hana", "rafa", "tara"]);
    expect(options[0].picks).toContain("Spirited Away");

    // A real account (even a member) and no session: the same plain 404 for list and scan.
    await expect(demo.demoFriendOptions(repo, realSession, group.id)).rejects.toMatchObject({ status: 404 });
    await expect(demo.demoFriendOptions(repo, null, group.id)).rejects.toMatchObject({ status: 404 });
    await expect(demo.demoFriendScan(repo, realSession, group.id, "mira")).rejects.toMatchObject({ status: 404 });
    expect((await repo.groups.get(group.id))!.members).toHaveLength(1);
  });

  it("refuses a group the demo account didn't start, and anyone who isn't a demo friend", async () => {
    const real = await svc.createGroup(REAL_UID, { size: 3, profile: card("Priya") }, repo);
    await svc.joinGroup(DEMO_UID, { token: real.join.token, profile: card("Demo") }, repo);
    await expect(demo.demoFriendOptions(repo, demoSession, real.group.id)).rejects.toMatchObject({ status: 404 });
    await expect(demo.demoFriendScan(repo, demoSession, real.group.id, "mira")).rejects.toMatchObject({ status: 404 });
    expect((await repo.groups.get(real.group.id))!.members.some((m) => m.isDemoFriend)).toBe(false);

    const mine = await svc.createGroup(DEMO_UID, { size: 2, profile: card("Demo") }, repo);
    await expect(demo.demoFriendScan(repo, demoSession, mine.group.id, "priya")).rejects.toMatchObject({ status: 400 });
    await expect(demo.demoFriendScan(repo, demoSession, mine.group.id, REAL_UID)).rejects.toMatchObject({ status: 400 });
  });

  it("joins the picked friend like a real scan, and the group forms when full", async () => {
    const { group } = await svc.createGroup(DEMO_UID, { size: 3, profile: card("Demo") }, repo);
    expect(await demo.demoFriendScan(repo, demoSession, group.id, "mira")).toEqual({ formed: false, friend: "mira" });
    expect((await demo.demoFriendOptions(repo, demoSession, group.id)).map((o) => o.key)).not.toContain("mira");
    await expect(demo.demoFriendScan(repo, demoSession, group.id, "mira")).rejects.toMatchObject({ status: 409 });
    expect(await demo.demoFriendScan(repo, demoSession, group.id, "arjun")).toEqual({ formed: true, friend: "arjun" });

    const g = (await repo.groups.get(group.id))!;
    expect(g.members.map((m) => [m.name, !!m.isDemoFriend])).toEqual([
      ["Demo", false],
      ["Mira", true],
      ["Arjun", true],
    ]);
    expect(g.joinOpenUntil).toBe(0);
    // Full now: the picker answers "closed".
    await expect(demo.demoFriendOptions(repo, demoSession, group.id)).rejects.toMatchObject({ status: 409 });

    expect(await svc.openGroup(group.id, NO_QLOO, repo)).toBe(true);
    expect(await demo.postDemoReply(repo, group.id, "arjun")).toBe(true);
    expect(await demo.postDemoReply(repo, group.id, "arjun")).toBe(false);
    const lines = await repo.groupMessages.list(group.id, { sinceAt: 0, limit: 10 });
    expect(lines.map((l) => l.kind)).toEqual(["opening", "person"]);
    expect(lines[1].from).toBe(g.members[2].id);
  });

  it("never adds a demo friend to a group a real person already joined", async () => {
    const { group, join } = await svc.createGroup(DEMO_UID, { size: 4, profile: card("Demo") }, repo);
    await svc.joinGroup(REAL_UID, { token: join.token, profile: card("Priya") }, repo);
    await expect(demo.demoFriendOptions(repo, demoSession, group.id)).rejects.toMatchObject({ status: 404 });
    await expect(demo.demoFriendScan(repo, demoSession, group.id, "mira")).rejects.toMatchObject({ status: 404 });
  });

  it("stops once joining is closed", async () => {
    const { group } = await svc.createGroup(DEMO_UID, { size: 4, profile: card("Demo") }, repo);
    await svc.closeJoining(DEMO_UID, group.id, repo);
    await expect(demo.demoFriendScan(repo, demoSession, group.id, "hana")).rejects.toMatchObject({ status: 409 });
  });
});
