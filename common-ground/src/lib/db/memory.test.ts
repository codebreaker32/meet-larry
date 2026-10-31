import { afterEach, describe, expect, it, vi } from "vitest";
import type { MeetKv } from "../meet/kv";
import { getRepo, repoKind } from "./index";
import { createMemoryRepo, memoryRepo, resetMemoryRepo } from "./memory";
import type { StoredAccount } from "./types";

const account = (uid: string, over: Partial<StoredAccount> = {}): StoredAccount => ({
  uid,
  name: "Sam",
  username: `QuietOtter${uid.length}`,
  createdAt: 1,
  budgetCentsLeft: 25,
  glory: 0,
  sharingWithFriends: false,
  showOnLeaderboards: false,
  publicTitleCounts: {},
  dob: { d: 1, m: 1, y: 2000 },
  ...over,
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("memory repo", () => {
  it("creates, updates and deletes accounts, and returns copies", async () => {
    const r = createMemoryRepo();
    expect(await r.accounts.create(account("u1"))).toBe(true);
    expect((await r.accounts.get("u1"))!.showOnLeaderboards).toBe(false);
    expect(await r.accounts.create(account("u1", { name: "Other" }))).toBe(false);
    const got = (await r.accounts.get("u1"))!;
    got.glory = 999;
    expect((await r.accounts.get("u1"))!.glory).toBe(0);
    const up = await r.accounts.update("u1", (a) => ({ ...a, glory: a.glory + 10, uid: "hijack" }));
    expect(up).toMatchObject({ uid: "u1", glory: 10 });
    expect(await r.accounts.update("nobody", (a) => a)).toBeNull();
    await r.accounts.delete("u1");
    expect(await r.accounts.get("u1")).toBeNull();
  });

  it("keeps usernames unique without regard to case", async () => {
    const r = createMemoryRepo();
    expect(await r.usernames.claim("QuietOtter42", "a")).toBe(true);
    expect(await r.usernames.claim("quietotter42", "b")).toBe(false);
    expect(await r.usernames.claim("QUIETOTTER42", "a")).toBe(true);
    await r.usernames.release("QuietOtter42", "b");
    expect(await r.usernames.owner("quietOtter42")).toBe("a");
    await r.usernames.release("QuietOtter42", "a");
    expect(await r.usernames.owner("QuietOtter42")).toBeNull();
  });

  it("ranks a podium by visits, moves on re-roll and removes entries", async () => {
    const r = createMemoryRepo();
    await r.podium.add("p1", "aa", 2);
    await r.podium.add("p1", "bb", 5);
    await r.podium.add("p1", "cc", 2);
    expect(await r.podium.add("p1", "aa")).toBe(3);
    await r.podium.add("p2", "zz", 50);
    expect(await r.podium.top("p1", 3)).toEqual([
      { podiumId: "bb", visits: 5 },
      { podiumId: "aa", visits: 3 },
      { podiumId: "cc", visits: 2 },
    ]);
    expect(await r.podium.participants("p1")).toBe(3);
    expect(await r.podium.participants("p2")).toBe(1);
    expect(await r.podium.move("p1", "aa", "dd")).toBe(true);
    expect(await r.podium.move("p1", "nope", "ee")).toBe(false);
    expect((await r.podium.top("p1", 1))[0].podiumId).toBe("bb");
    await r.podium.remove([{ placeId: "p1", podiumId: "bb" }]);
    expect((await r.podium.top("p1", 3)).map((x) => x.podiumId)).toEqual(["dd", "cc"]);
  });

  it("links friends both ways and unlinks everything on removeAll", async () => {
    const r = createMemoryRepo();
    await r.friends.add("a", "b");
    await r.friends.add("a", "c");
    await r.friends.add("a", "a");
    expect(await r.friends.are("b", "a")).toBe(true);
    expect(await r.friends.bumpTimesMet("b", "a")).toBe(1);
    expect(await r.friends.list("a")).toEqual(expect.arrayContaining([{ uid: "b", timesMet: 1 }, { uid: "c", timesMet: 0 }]));
    expect(await r.friends.bumpTimesMet("b", "c")).toBe(0);
    await r.friends.removeAll("a");
    expect(await r.friends.list("b")).toEqual([]);
    expect(await r.friends.list("a")).toEqual([]);
  });

  it("uses an invite once, and never after it expires", async () => {
    const r = createMemoryRepo();
    await r.invites.create({ codeHash: "h1", uid: "a", expiresAt: 1000 });
    await r.invites.create({ codeHash: "h2", uid: "a", expiresAt: 1000 });
    await r.invites.create({ codeHash: "h3", uid: "b", expiresAt: 1000 });
    expect(await r.invites.take("h1", 999)).toMatchObject({ uid: "a" });
    expect(await r.invites.take("h1", 999)).toBeNull();
    expect(await r.invites.take("h2", 1000)).toBeNull();
    await r.invites.deleteByUid("b");
    expect(await r.invites.take("h3", 0)).toBeNull();
  });

  it("has a TTL key-value store shaped like MeetKv", async () => {
    vi.useFakeTimers();
    const r = createMemoryRepo();
    const kv: MeetKv = r.kv;
    await kv.update<number>("day:x", (n) => (n ?? 0) + 1, 1000);
    expect(await kv.get("day:x")).toBe(1);
    expect(await kv.update<number>("day:x", () => null)).toBe(1);
    vi.advanceTimersByTime(1001);
    expect(await kv.get("day:x")).toBeNull();
    await kv.update("k", () => ({ a: 1 }));
    await kv.update("k", () => undefined);
    expect(await kv.get("k")).toBeNull();
  });

  it("shares one store per process and resets for tests", async () => {
    await memoryRepo().sync.put("u", { persona: null, steps: [], placeCounters: [] });
    expect(await memoryRepo().sync.get("u")).not.toBeNull();
    resetMemoryRepo();
    expect(await memoryRepo().sync.get("u")).toBeNull();
  });
});

describe("getRepo", () => {
  it("uses memory outside production and when LARRY_DB=memory", () => {
    vi.stubEnv("LARRY_DB", "memory");
    expect(getRepo().kind).toBe("memory");
    vi.stubEnv("LARRY_DB", "");
    vi.stubEnv("NODE_ENV", "test");
    expect(repoKind()).toBe("memory");
  });

  it("defaults to Firestore in production, with no memory fallback there", () => {
    vi.stubEnv("LARRY_DB", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(repoKind()).toBe("firestore");
    expect(getRepo().kind).toBe("firestore");
  });

  it("falls back to memory in development when there are no credentials, and says so once", () => {
    vi.stubEnv("LARRY_DB", "firestore");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "/nonexistent/adc.json");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    (globalThis as { __larryRepoWarned?: boolean }).__larryRepoWarned = false;
    expect(getRepo().kind).toBe("memory");
    expect(getRepo().kind).toBe("memory");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("application-default login");
    warn.mockRestore();
  });
});
