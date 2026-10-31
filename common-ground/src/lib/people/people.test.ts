import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryRepo } from "@/lib/db/memory";
import type { Repo } from "@/lib/db/types";
import { createGroup, joinGroup, block } from "@/lib/groups/service";
import { ALIAS_RE } from "@/lib/alias";
import { PODIUM_MIN_PARTICIPANTS, addPodiumVisit, podiumIdOf, readPodium, removeMine, rerollPodium } from "./podium";
import { friendTitles, rivalryLine } from "./titles-compute";
import { profileFor } from "./profile";

let repo: Repo;
const key = (n: number) => n.toString(16).padStart(64, "0");

async function account(uid: string, name: string, username: string, o: { sharing?: boolean; board?: boolean } = {}) {
  await repo.accounts.create({
    uid,
    name,
    username,
    createdAt: 0,
    budgetCentsLeft: 25,
    glory: 40,
    sharingWithFriends: !!o.sharing,
    showOnLeaderboards: !!o.board,
    publicTitleCounts: { "final-boss": 2 },
    dob: { d: 1, m: 1, y: 1990 },
  });
  await repo.usernames.claim(username, uid);
}

async function befriend(a: string, b: string) {
  const g = await createGroup(a, { size: 2, profile: { name: "A", items: [] } }, repo);
  await joinGroup(b, { token: g.join.token, profile: { name: "B", items: [] } }, repo);
}

const session = (uid: string) => ({ uid, isAdult: true as const, isDemo: false });

beforeEach(async () => {
  repo = createMemoryRepo();
  await account("u1", "Sam", "QuietOtter42", { sharing: true, board: true });
  await account("u2", "Priya", "MossyBadger7", { sharing: true });
  await account("u3", "Ana", "BraveFalcon3");
});

describe("podium", () => {
  it("counts a verified visit only with leaderboards on and a secret key, and stores no uid", async () => {
    expect(await addPodiumVisit(session("u2"), "p1", key(1), repo)).toBe(false);
    expect(await addPodiumVisit(session("u1"), "p1", undefined, repo)).toBe(false);
    expect(await addPodiumVisit(null, "p1", key(1), repo)).toBe(false);
    expect(await addPodiumVisit(session("u1"), "p1", key(1), repo)).toBe(true);
    const rows = await repo.podium.top("p1", 5);
    expect(rows).toEqual([{ podiumId: podiumIdOf(key(1)), visits: 1 }]);
    expect(JSON.stringify(rows)).not.toMatch(/u1/);
  });

  it("stays closed below the minimum, then shows ranks with ties, aliases and no visit numbers", async () => {
    await repo.podium.add("p1", podiumIdOf(key(1)), 5);
    expect((await readPodium("p1", repo)).open).toBe(PODIUM_MIN_PARTICIPANTS <= 1);
    await repo.podium.add("p1", podiumIdOf(key(2)), 5);
    await repo.podium.add("p1", podiumIdOf(key(3)), 2);
    await repo.podium.add("p1", podiumIdOf(key(4)), 1);
    await repo.podium.add("p1", podiumIdOf(key(5)), 1);
    const p = await readPodium("p1", repo);
    expect(p.open).toBe(true);
    expect(p.entries.map((e) => [e.rank, e.title])).toEqual([
      [1, "final-boss"],
      [1, "final-boss"],
      [2, "guildmaster"],
      [3, "shogun"],
      [3, "shogun"],
    ]);
    for (const e of p.entries) expect(e.alias).toMatch(ALIAS_RE);
    expect(JSON.stringify(p)).not.toMatch(/visits|"5"|podiumId/);
  });

  it("re-roll needs the old secret key; a public alias can't move a count", async () => {
    await repo.podium.add("p1", podiumIdOf(key(1)), 3);
    expect(await rerollPodium("p1", podiumIdOf(key(1)), key(9), repo)).toBe(false);
    expect(await rerollPodium("p1", key(1), key(9), repo)).toBe(true);
    expect(await repo.podium.top("p1", 5)).toEqual([{ podiumId: podiumIdOf(key(9)), visits: 3 }]);
    await removeMine([{ placeId: "p1", key: key(9) }], repo);
    expect(await repo.podium.participants("p1")).toBe(0);
  });
});

describe("friend titles and the rivalry line", () => {
  const circle = [
    { uid: "a", name: "Sam", places: [{ placeId: "c", placeName: "Café Condi", visits: 4 }] },
    { uid: "b", name: "Priya", places: [{ placeId: "c", placeName: "Café Condi", visits: 5 }] },
    { uid: "d", name: "Ana", places: [{ placeId: "c", placeName: "Café Condi", visits: 2 }] },
  ];

  it("ranks friends at a place, needing at least two of them there", () => {
    expect(friendTitles(circle).map((t) => [t.uid, t.title])).toEqual([
      ["b", "party-leader"],
      ["a", "squad-captain"],
      ["d", "crew-leader"],
    ]);
    expect(friendTitles([circle[0]])).toEqual([]);
  });

  it("gives the owner one line when a title is within reach, never naming the friend or their count", () => {
    expect(rivalryLine("a", circle)).toBe("2 visits until you take Party Leader at Café Condi");
    expect(rivalryLine("b", circle)).toBeUndefined();
    expect(rivalryLine("a", circle)).not.toMatch(/Priya|5/);
  });
});

describe("profile by viewer", () => {
  beforeEach(async () => {
    await repo.sync.put("u1", { persona: null, steps: [], placeCounters: [{ placeId: "c", placeName: "Café Condi", visits: 4, stage: "regular", spotWeeks: 3 }] });
    await repo.sync.put("u2", { persona: null, steps: [], placeCounters: [{ placeId: "c", placeName: "Café Condi", visits: 5, stage: "regular", spotWeeks: 4 }] });
    await repo.profiles.put("u1", { publicTitles: [{ title: "final-boss", venue: { placeId: "c", placeName: "Café Condi" } }] });
  });

  it("a stranger sees the username and counts only: no venue, place, Glory or stage", async () => {
    for (const viewer of [null, "u3"]) {
      const p = await profileFor(viewer, "QuietOtter42", repo);
      expect(p).toEqual({ viewer: "stranger", username: "QuietOtter42", publicTitles: [{ title: "final-boss", places: 2 }] });
      expect(JSON.stringify(p)).not.toMatch(/Condi|placeId|glory|regular|Sam/);
    }
  });

  it("someone off leaderboards shows no counts to strangers", async () => {
    expect(await profileFor(null, "MossyBadger7", repo)).toEqual({ viewer: "stranger", username: "MossyBadger7", publicTitles: [] });
  });

  it("a friend sees venues, Glory and friend titles only when both share", async () => {
    await befriend("u1", "u2");
    const p = await profileFor("u2", "QuietOtter42", repo);
    expect(p).toMatchObject({ viewer: "friend", displayName: "Sam", sharing: true, glory: 40 });
    if (p?.viewer !== "friend") throw new Error("expected friend");
    expect(p.publicTitles[0].venue.placeName).toBe("Café Condi");
    expect(p.friendTitles).toEqual([{ title: "squad-captain", venue: { placeId: "c", placeName: "Café Condi" } }]);

    await repo.accounts.update("u2", (a) => ({ ...a, sharingWithFriends: false }));
    const off = await profileFor("u2", "QuietOtter42", repo);
    expect(off).toMatchObject({ viewer: "friend", sharing: false, publicTitles: [], friendTitles: [] });
    expect(JSON.stringify(off)).not.toMatch(/Condi|glory/);
  });

  it("the owner sees everything, including the next stage and the rivalry line", async () => {
    await befriend("u1", "u2");
    const p = await profileFor("u1", "QuietOtter42", repo);
    if (p?.viewer !== "owner") throw new Error("expected owner");
    expect(p.places[0]).toMatchObject({ stage: "regular", visits: 4, nextStage: { stage: "veteran", visitsAway: 2 } });
    expect(p.rivalry).toBe("2 visits until you take Party Leader at Café Condi");
  });

  it("block hides the profile completely, the same as an unknown name", async () => {
    await befriend("u1", "u2");
    await block("u1", "u2", repo);
    expect(await profileFor("u2", "QuietOtter42", repo)).toBeNull();
    expect(await profileFor("u2", "NobodyHere1", repo)).toBeNull();
  });
});
