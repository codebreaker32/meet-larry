import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryRepo } from "../db/memory";
import type { Repo } from "../db/types";
import { createGroup, joinGroup } from "../groups/service";
import { ACCOUNT_BUDGET_CENTS, chargeAccount, deleteAccountData, publicAccount, putSync, signup, updateSettings } from "./service";

const NOW = new Date(Date.UTC(2026, 9, 30));
const adult = { name: "Sam", username: "QuietOtter42", dob: { d: 1, m: 1, y: 1990 } };
let repo: Repo;

beforeEach(() => {
  repo = createMemoryRepo();
});

describe("sign-up", () => {
  it("makes an 18+ account with 25 cents, leaderboards off, and no phone or date of birth in the answer", async () => {
    const r = await signup("u1", adult, NOW, repo);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.account).toMatchObject({ uid: "u1", username: adult.username, budgetCentsLeft: ACCOUNT_BUDGET_CENTS, glory: 0, showOnLeaderboards: false, sharingWithFriends: false });
    expect(JSON.stringify(r.account)).not.toMatch(/dob|1990|phone/);
    // Only the range, so the device range matches the 18+ account (never the date itself).
    expect(r.account.ageBucket).toBe("35-44");
    expect(await repo.usernames.owner(adult.username)).toBe("u1");
  });

  it("turns away under-18s and keeps nothing", async () => {
    const r = await signup("kid", { ...adult, dob: { d: 31, m: 10, y: 2008 } }, NOW, repo);
    expect(r).toMatchObject({ ok: false, status: 403, reason: "under-18" });
    expect(await repo.accounts.get("kid")).toBeNull();
    expect(await repo.usernames.owner(adult.username)).toBeNull();
    // Turning 18 today counts.
    const birthday = await signup("eighteen", { ...adult, username: "BraveHeron31", dob: { d: 30, m: 10, y: 2008 } }, NOW, repo);
    expect(birthday.ok).toBe(true);
  });

  it("refuses impossible dates", async () => {
    expect(await signup("u1", { ...adult, dob: { d: 31, m: 2, y: 1990 } }, NOW, repo)).toMatchObject({ ok: false, reason: "bad-date" });
  });

  it("keeps usernames unique, case-insensitively", async () => {
    await signup("u1", adult, NOW, repo);
    expect(await signup("u2", { ...adult, username: "quietotter42" }, NOW, repo)).toMatchObject({ ok: false, status: 409 });
  });

  it("returns the existing account on a second tap", async () => {
    await signup("u1", adult, NOW, repo);
    const again = await signup("u1", { ...adult, name: "Other" }, NOW, repo);
    expect(again).toMatchObject({ ok: true, created: false, account: { name: "Sam" } });
  });
});

describe("Larry time", () => {
  it("never goes below 0 and ignores broken amounts", async () => {
    await signup("u1", adult, NOW, repo);
    expect(await chargeAccount("u1", 10, repo)).toBe(15);
    expect(await chargeAccount("u1", -50, repo)).toBe(15);
    expect(await chargeAccount("u1", Number.NaN, repo)).toBe(15);
    expect(await chargeAccount("u1", 100, repo)).toBe(0);
    expect(await chargeAccount("nobody", 1, repo)).toBeNull();
  });
});

describe("settings, sync and deletion", () => {
  it("switches 'Show me on place leaderboards' on and off", async () => {
    await signup("u1", adult, NOW, repo);
    expect((await updateSettings("u1", { showOnLeaderboards: true }, repo))!.showOnLeaderboards).toBe(true);
    expect((await updateSettings("u1", { showOnLeaderboards: false }, repo))!.showOnLeaderboards).toBe(false);
    expect(await updateSettings("nobody", { showOnLeaderboards: true }, repo)).toBeNull();
  });

  it("stores the sync blob and copies public title counts onto the account", async () => {
    await signup("u1", adult, NOW, repo);
    const ok = await putSync("u1", { persona: null, steps: [], placeCounters: [], publicTitleCounts: { "final-boss": 1 } }, repo);
    expect(ok).toBe(true);
    expect((await repo.accounts.get("u1"))!.publicTitleCounts).toEqual({ "final-boss": 1 });
    expect(await putSync("nobody", { persona: null, steps: [], placeCounters: [] }, repo)).toBe(false);
  });

  it("deletes every server copy", async () => {
    await signup("u1", adult, NOW, repo);
    await signup("u2", { ...adult, username: "BraveHeron31" }, NOW, repo);
    await repo.sync.put("u1", { persona: null, steps: [], placeCounters: [] });
    await repo.profiles.put("u1", { publicTitles: [] });
    await repo.friends.add("u1", "u2");
    await repo.invites.create({ codeHash: "h", uid: "u1", expiresAt: Date.now() + 1e6 });
    await deleteAccountData("u1", repo);
    expect(await repo.accounts.get("u1")).toBeNull();
    expect(await repo.usernames.owner(adult.username)).toBeNull();
    expect(await repo.sync.get("u1")).toBeNull();
    expect(await repo.profiles.get("u1")).toBeNull();
    expect(await repo.friends.list("u2")).toEqual([]);
    expect(await repo.invites.take("h", Date.now())).toBeNull();
    expect(await repo.accounts.get("u2")).not.toBeNull();
  });

  it("takes the person out of every group, so no seat, username or block is left behind", async () => {
    await signup("u1", adult, NOW, repo);
    await signup("u2", { ...adult, name: "Priya", username: "BraveHeron31" }, NOW, repo);
    await signup("u3", { ...adult, name: "Ana", username: "MossyBadger7" }, NOW, repo);
    const two = await createGroup("u1", { size: 2, profile: { name: "Sam", items: [] } }, repo);
    await joinGroup("u2", { token: two.join.token, profile: { name: "Priya", items: [] } }, repo);
    const three = await createGroup("u3", { size: 3, profile: { name: "Ana", items: [] } }, repo);
    await joinGroup("u1", { token: three.join.token, profile: { name: "Sam", items: [] } }, repo);
    const solo = await createGroup("u1", { size: 3, profile: { name: "Sam", items: [] } }, repo);
    await repo.blocks.add("u1", "u2");
    await deleteAccountData("u1", repo);
    // The last one out deletes the group.
    expect(await repo.groups.get(solo.group.id)).toBeNull();
    expect(await repo.groups.listFor("u1")).toEqual([]);
    // A group of 2 empties to one member and stays theirs; Sam's seat is gone from both.
    expect((await repo.groups.get(two.group.id))?.memberUids ?? []).not.toContain("u1");
    expect((await repo.groups.get(three.group.id))?.memberUids).toEqual(["u3"]);
    expect(await repo.blocks.between("u1", "u2")).toBe(false);
  });

  it("publicAccount strips the date of birth", () => {
    const a = publicAccount({ ...adult, uid: "u", createdAt: 1, budgetCentsLeft: 3.333, glory: 0, sharingWithFriends: false, showOnLeaderboards: false, publicTitleCounts: {}, dob: { d: 1, m: 1, y: 1990 } });
    expect("dob" in a).toBe(false);
    expect(a.budgetCentsLeft).toBe(3.33);
  });
});
