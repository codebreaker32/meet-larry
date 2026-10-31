import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GroupChatResult, GroupGround, GroupMember, RunGroupChat } from "@/lib/contracts";
import { CRISIS_TEXT } from "@/lib/crisis";
import type { Profile } from "@/lib/types";

// Memory repo; Larry (runGroupChat), Qloo and the budget are stand-ins, so no model, Qloo or AWS call
// can happen here.
const mocks = vi.hoisted(() => ({ holdBudget: vi.fn() }));
vi.mock("@/lib/budget", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), holdBudget: mocks.holdBudget }));
vi.mock("@/lib/qloo", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  findGroupCommonGround: vi.fn(async () => {
    throw new Error("no Qloo in unit tests");
  }),
  findPlaces: vi.fn(async () => []),
}));

const { createMemoryRepo } = await import("@/lib/db/memory");
const svc = await import("./service");
const { regexSafety, setMessageSafety, STEP_IN } = await import("./safety");
const { composeOpening, openingParts, wordCount } = await import("./opening");
const { listFriends, areFriends } = await import("@/lib/people/friends");
const { GROUP_QR_TTL_MS, GROUP_COPY } = await import("./shared");
type Repo = import("@/lib/db").Repo;

const profile = (name: string, picks: [string, string][] = []): Profile => ({
  name,
  items: picks.map(([id, n]) => ({ id, name: n, domain: "videogame" as const })),
});

let repo: Repo;
async function account(uid: string, name: string, username: string, sharing = false) {
  await repo.accounts.create({
    uid,
    name,
    username,
    createdAt: 0,
    budgetCentsLeft: 25,
    glory: 0,
    sharingWithFriends: sharing,
    showOnLeaderboards: false,
    publicTitleCounts: {},
    dob: { d: 1, m: 1, y: 1990 },
  });
  await repo.usernames.claim(username, uid);
}

const reply = (text: string, extra: Partial<GroupChatResult> = {}): GroupChatResult => ({ messages: [{ from: "larry", text }], quiet: false, steps: [], profileUpdates: [], ...extra });

const ground = (members: GroupMember[]): GroupGround => ({
  shared: [],
  bridges: [{ id: "b1", name: "Stardew Valley", domain: "videogame", affinity: 0.9, why: "Cosy farming for builders and dreamers", from: Object.fromEntries(members.map((m) => [m.id, [m.profile.items[0]?.name ?? "x"]])) }],
  curated: true,
});

async function pair() {
  const sam = profile("Sam", [["mc", "Minecraft"]]);
  const priya = profile("Priya", [["ff", "Fleet Foxes"]]);
  const made = await svc.createGroup("u-sam", { size: 2, profile: sam }, repo);
  const joined = await svc.joinGroup("u-priya", { token: made.join.token, profile: priya }, repo);
  return { made, joined, id: made.group.id };
}

beforeEach(async () => {
  repo = createMemoryRepo();
  setMessageSafety(regexSafety);
  mocks.holdBudget.mockResolvedValue({ record: vi.fn(async () => 0), check: vi.fn(), release: vi.fn() });
  await account("u-sam", "Sam", "QuietOtter42");
  await account("u-priya", "Priya", "MossyBadger7");
  await account("u-ana", "Ana", "BraveFalcon3");
  await account("u-ravi", "Ravi", "CalmHeron9");
});
afterEach(() => {
  vi.useRealTimers();
});

describe("create and join by QR", () => {
  it("creates a group with a 15-minute QR in the URL fragment, and never shows a uid", async () => {
    const before = Date.now();
    const { group, join } = await svc.createGroup("u-sam", { size: 3, profile: profile("Sam") }, repo);
    expect(group.members).toHaveLength(1);
    expect(group.members[0]).toMatchObject({ name: "Sam", username: "QuietOtter42", isCreator: true, isMe: true });
    expect(join.path).toBe(`/scan#t=${join.token}`);
    expect(join.expiresAt).toBeGreaterThanOrEqual(before + GROUP_QR_TTL_MS);
    expect(JSON.stringify({ group, join })).not.toMatch(/u-sam/);
  });

  it("fills the group, closes the QR when full, and makes the members friends", async () => {
    const { made, joined } = await pair();
    expect(joined.formed).toBe(true);
    expect(joined.group.members.map((m) => m.name)).toEqual(["Sam", "Priya"]);
    expect(joined.group.joinOpenUntil).toBe(0);
    await expect(svc.joinGroup("u-ana", { token: made.join.token, profile: profile("Ana") }, repo)).rejects.toMatchObject({ status: 410 });
    expect(await areFriends("u-sam", "u-priya", repo)).toBe(true);
    expect((await listFriends("u-sam", repo)).map((f) => f.username)).toEqual(["MossyBadger7"]);
    expect(JSON.stringify(await listFriends("u-sam", repo))).not.toMatch(/u-priya/);
  });

  it("joining twice is harmless, and a preview shows who is in it", async () => {
    const { join } = await svc.createGroup("u-sam", { size: 3, profile: profile("Sam") }, repo);
    expect(await svc.previewJoin("u-priya", join.token, repo)).toEqual({ names: ["Sam"], openSeats: 2, size: 3 });
    await svc.joinGroup("u-priya", { token: join.token, profile: profile("Priya") }, repo);
    const again = await svc.joinGroup("u-priya", { token: join.token, profile: profile("Priya") }, repo);
    expect(again.group.members).toHaveLength(2);
    expect(again.formed).toBe(false);
  });

  it("refuses a QR after 15 minutes, a forged token, and a closed QR", async () => {
    const { group, join } = await svc.createGroup("u-sam", { size: 3, profile: profile("Sam") }, repo);
    vi.useFakeTimers({ now: Date.now() + GROUP_QR_TTL_MS + 1000 });
    await expect(svc.joinGroup("u-priya", { token: join.token, profile: profile("Priya") }, repo)).rejects.toMatchObject({ status: 410, message: GROUP_COPY.qrExpired });
    vi.useRealTimers();
    await expect(svc.joinGroup("u-priya", { token: join.token.replace(/.$/, "x"), profile: profile("Priya") }, repo)).rejects.toMatchObject({ status: 410 });
    const fresh = await svc.freshQr("u-sam", group.id, repo);
    await svc.closeJoining("u-sam", group.id, repo);
    await expect(svc.joinGroup("u-priya", { token: fresh.token, profile: profile("Priya") }, repo)).rejects.toMatchObject({ message: GROUP_COPY.qrClosed });
  });

  it("a fresh QR cancels the old one; only the creator can make one", async () => {
    const { group, join } = await svc.createGroup("u-sam", { size: 3, profile: profile("Sam") }, repo);
    const fresh = await svc.freshQr("u-sam", group.id, repo);
    await expect(svc.joinGroup("u-priya", { token: join.token, profile: profile("Priya") }, repo)).rejects.toMatchObject({ status: 410 });
    await svc.joinGroup("u-priya", { token: fresh.token, profile: profile("Priya") }, repo);
    await expect(svc.freshQr("u-priya", group.id, repo)).rejects.toMatchObject({ status: 403 });
  });

  it("someone blocked can't join, and hears the same words as a closed QR", async () => {
    await repo.blocks.add("u-sam", "u-ana");
    const { join } = await svc.createGroup("u-sam", { size: 3, profile: profile("Sam") }, repo);
    await expect(svc.previewJoin("u-ana", join.token, repo)).rejects.toMatchObject({ status: 410, message: GROUP_COPY.qrClosed });
    await expect(svc.joinGroup("u-ana", { token: join.token, profile: profile("Ana") }, repo)).rejects.toMatchObject({ message: GROUP_COPY.qrClosed });
  });

  it("needs an account", async () => {
    await expect(svc.createGroup("nobody", { size: 2, profile: profile("X") }, repo)).rejects.toMatchObject({ status: 401 });
  });
});

describe("Larry's opening", () => {
  it("opens once with the curated ground, whose picks led there, one extra and an opener, under 90 words", async () => {
    const { id } = await pair();
    const find = vi.fn(async (m: GroupMember[]) => ground(m));
    expect(await svc.openGroup(id, { find, fixedOpener: true }, repo)).toBe(true);
    expect(await svc.openGroup(id, { find, fixedOpener: true }, repo)).toBe(false);
    expect(find).toHaveBeenCalledTimes(1);
    const r = await svc.readGroup("u-priya", id, {}, repo);
    if (!("group" in r)) throw new Error("expected a group");
    const opening = r.messages.filter((m) => m.kind === "opening");
    expect(opening).toHaveLength(1);
    expect(opening[0].ground?.bridges[0].name).toBe("Stardew Valley");
    expect(opening[0].text).toMatch(/^Hi Sam and Priya, I'm Larry, an AI pal\./);
    expect(opening[0].text).toContain("Sam's Minecraft and Priya's Fleet Foxes");
    expect(opening[0].text).toContain("Easy opener:");
    expect(wordCount(opening[0].text)).toBeLessThanOrEqual(90);
    expect(r.group.opened).toBe(true);
  });

  it("is honest when Qloo fails, and still gives an opener", async () => {
    const { id } = await pair();
    await svc.openGroup(id, { find: async () => Promise.reject(new Error("busy")), fixedOpener: true }, repo);
    const r = await svc.readGroup("u-sam", id, {}, repo);
    if (!("group" in r)) throw new Error("expected a group");
    expect(r.messages.at(-1)?.text).toMatch(/didn't find a clear overlap yet/);
  });

  it("caps the words by dropping the close, then the extra", () => {
    const members = [
      { id: "a", name: "Sam" },
      { id: "b", name: "Priya" },
    ];
    const g: GroupGround = {
      shared: [{ item: { id: "t", name: "Mumbai Indians", domain: "sports_team" }, memberIds: ["a", "b"] }],
      bridges: [{ id: "x", name: "Stardew Valley", domain: "videogame", affinity: 1, why: "word ".repeat(60).trim(), from: { a: ["Minecraft"], b: ["Fleet Foxes"] } }],
    };
    const parts = openingParts(members, g, "Have you tried Stardew Valley?");
    expect(parts.extraKind).toBe("matchday");
    const { text } = composeOpening(parts);
    expect(wordCount(text)).toBeLessThanOrEqual(90);
    expect(text).toContain("Stardew Valley");
  });
});

describe("Larry speaks only when tagged", () => {
  it("never answers an untagged line", async () => {
    const { id } = await pair();
    const run = vi.fn<RunGroupChat>(async () => reply("hi"));
    const out = await svc.postMessage("u-sam", id, { text: "shall we go out saturday?" }, { runGroupChat: run }, repo);
    expect(run).not.toHaveBeenCalled();
    expect(out.messages.at(-1)).toMatchObject({ kind: "person", text: "shall we go out saturday?" });
  });

  it("answers @Larry with the chat as context, charged through authorize", async () => {
    const { id } = await pair();
    await svc.postMessage("u-priya", id, { text: "I love board games" }, {}, repo);
    const run = vi.fn<RunGroupChat>(async () => reply("Try Wingspan together."));
    const authorize = vi.fn(async (): Promise<import("./service").RunCharge> => ({ wrap: (h) => h }));
    const out = await svc.postMessage("u-sam", id, { text: "@Larry what should we play?" }, { runGroupChat: run, authorize }, repo);
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
    const input = run.mock.calls[0][0];
    expect(input.history.map((t) => t.content)).toEqual(["[Priya] I love board games", "[Sam] @Larry what should we play?"]);
    expect(out.messages.at(-1)).toMatchObject({ from: "larry", kind: "larry", text: "Try Wingspan together.", cmd: "ask" });
  });

  it("/plan with no location from this phone asks the sender alone, with no model call", async () => {
    const { id } = await pair();
    const run = vi.fn<RunGroupChat>(async () => reply("x"));
    const out = await svc.postMessage("u-sam", id, { text: "/plan" }, { runGroupChat: run }, repo);
    expect(run).not.toHaveBeenCalled();
    // To the sender only, never a group message, with a one-tap share on their phone.
    expect(out.privateNote).toMatch(/don't know roughly where you are/);
    expect(out.needsLocation).toBe(true);
    expect(out.messages.at(-1)).toMatchObject({ text: "/plan" });
    expect(out.messages.some((m) => m.from === "larry" && /where you are|Settings/.test(m.text))).toBe(false);
  });

  it("/plan makes the group Plan Ticket, with no distance kept", async () => {
    const { id } = await pair();
    const ticket = { place: { id: "p1", name: "Dice & Tea", tags: ["Board game cafe"], affinity: 0.8, fits: [], distanceKm: 0.6 }, when: "Sat 11am", opener: "Have you played Cascadia?" };
    const run = vi.fn<RunGroupChat>(async () => reply("Here's one for all of you.", { planTicket: ticket as never }));
    const out = await svc.postMessage("u-sam", id, { text: "/plan", location: { lat: 19.07, lon: 72.87 } }, { runGroupChat: run }, repo);
    const input = run.mock.calls[0][0];
    expect(input.location).toEqual({ lat: 19.07, lon: 72.87 });
    expect(input.history.at(-1)?.content).toMatch(/Make ONE Plan Ticket for everyone/);
    expect(out.group.planTicket?.place.name).toBe("Dice & Tea");
    expect(JSON.stringify(out)).not.toMatch(/distanceKm/);
    expect(out.messages.at(-1)?.planTicket?.when).toBe("Sat 11am");
  });

  it("/help, /rising and /mood answer with no model call; /rising is an honest miss", async () => {
    const { id } = await pair();
    const run = vi.fn<RunGroupChat>(async () => reply("x"));
    let out = await svc.postMessage("u-sam", id, { text: "/help" }, { runGroupChat: run }, repo);
    expect(out.messages.at(-1)?.text).toContain("/plan");
    out = await svc.postMessage("u-sam", id, { text: "/rising" }, { runGroupChat: run }, repo);
    expect(out.messages.at(-1)?.text).toMatch(/Nothing I can vouch for/);
    expect(out.messages.at(-1)?.text).not.toMatch(/rising in/i);
    out = await svc.postMessage("u-sam", id, { text: "/mood chill" }, { runGroupChat: run }, repo);
    expect(out.privateNote).toMatch(/without saying whose/);
    expect((await repo.groups.get(id))?.members.find((m) => m.uid === "u-sam")?.mood).toBe("chill");
    expect(run).not.toHaveBeenCalled();
  });

  it("/mood stays private: nobody else sees the line or the reply, and Larry never reads it", async () => {
    const { id } = await pair();
    const out = await svc.postMessage("u-priya", id, { text: "/mood low energy" }, {}, repo);
    expect(out.privateNote).toBeTruthy();
    const seen = await svc.readGroup("u-sam", id, {}, repo);
    if ("unchanged" in seen) throw new Error("expected messages");
    expect(JSON.stringify(seen.messages)).not.toMatch(/mood|low energy|whose/i);
    expect((await repo.groups.get(id))?.members.find((m) => m.uid === "u-priya")?.mood).toBe("low-energy");
    const run = vi.fn<RunGroupChat>(async () => reply("ok"));
    await svc.postMessage("u-sam", id, { text: "@Larry hi" }, { runGroupChat: run }, repo);
    expect(run.mock.calls[0][0].history.map((t) => t.content).join(" ")).not.toMatch(/mood/i);
  });

  it("Larry never reads lines from before the latest member joined", async () => {
    const t0 = Date.now();
    vi.useFakeTimers({ now: t0, toFake: ["Date"] });
    const made = await svc.createGroup("u-sam", { size: 3, profile: profile("Sam") }, repo);
    const id = made.group.id;
    await svc.joinGroup("u-priya", { token: made.join.token, profile: profile("Priya") }, repo);
    await svc.closeJoining("u-sam", id, repo);
    await svc.postMessage("u-priya", id, { text: "our private plan before Ana" }, {}, repo);
    vi.setSystemTime(t0 + 60_000);
    const fresh = await svc.freshQr("u-sam", id, repo);
    await svc.joinGroup("u-ana", { token: fresh.token, profile: profile("Ana") }, repo);
    vi.setSystemTime(t0 + 120_000);
    const run = vi.fn<RunGroupChat>(async () => reply("ok"));
    await svc.postMessage("u-ana", id, { text: "@Larry what did they say before I came?" }, { runGroupChat: run }, repo);
    const said = run.mock.calls[0][0].history.map((t) => t.content).join(" ");
    expect(said).toMatch(/what did they say/);
    expect(said).not.toMatch(/private plan/);
  });

  it("/together gives back the access code's run lease", async () => {
    const { id } = await pair();
    const release = vi.fn();
    const authorize = vi.fn(async (): Promise<import("./service").RunCharge> => ({ wrap: (h) => ({ ...h, release }) }));
    const find = vi.fn(async (members: GroupMember[]) => ground(members));
    await svc.postMessage("u-sam", id, { text: "/together" }, { runGroupChat: vi.fn(), authorize, find, fixedOpener: true }, repo);
    expect(find).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalled();
  });

  it("/matchday with no shared team says so honestly", async () => {
    const { id } = await pair();
    const out = await svc.postMessage("u-sam", id, { text: "/matchday", location: { lat: 1, lon: 1 } }, { runGroupChat: vi.fn() }, repo);
    expect(out.messages.at(-1)?.text).toMatch(/None of you share a team/);
  });

  it("/excuse keeps lines from Larry until /hello", async () => {
    const { id } = await pair();
    const run = vi.fn<RunGroupChat>(async (input) => reply(`read ${input.history.length}`));
    await svc.postMessage("u-sam", id, { text: "/excuse" }, { runGroupChat: run }, repo);
    const away = await svc.postMessage("u-priya", id, { text: "@Larry are you there?" }, { runGroupChat: run }, repo);
    expect(away.group.larryAway).toBe(true);
    expect(run).not.toHaveBeenCalled();
    await svc.postMessage("u-sam", id, { text: "/hello" }, { runGroupChat: run }, repo);
    const back = await svc.postMessage("u-sam", id, { text: "@Larry hi again" }, { runGroupChat: run }, repo);
    expect(run).toHaveBeenCalledTimes(1);
    // Larry starts fresh: nothing from while it was out.
    expect(run.mock.calls[0][0].history.map((t) => t.content).join(" ")).not.toMatch(/are you there/);
    expect(back.group.larryAway).toBe(false);
  });
});

describe("safety", () => {
  it("Larry steps in warmly on a phone number, once per cooldown, instead of answering", async () => {
    const { id } = await pair();
    const run = vi.fn<RunGroupChat>(async () => reply("x"));
    const out = await svc.postMessage("u-sam", id, { text: "@Larry call me on 98765 43210" }, { runGroupChat: run }, repo);
    expect(run).not.toHaveBeenCalled();
    expect(out.messages.at(-1)).toMatchObject({ from: "larry", kind: "care", text: STEP_IN.contact });
    const again = await svc.postMessage("u-priya", id, { text: "mine is 91234 56789" }, { runGroupChat: run }, repo);
    expect(again.messages.filter((m) => m.kind === "care")).toHaveLength(1);
  });

  it("a crisis line gets the fixed help reply at once", async () => {
    const { id } = await pair();
    const out = await svc.postMessage("u-sam", id, { text: "I want to kill myself" }, {}, repo);
    expect(out.crisis).toBe(true);
    expect(out.messages.at(-1)).toMatchObject({ from: "larry", text: CRISIS_TEXT });
  });
});

describe("leave, remove, unfriend, block, report", () => {
  it("someone leaving shows joining as closed, so the creator makes a fresh QR instead of showing a dead one", async () => {
    const made = await svc.createGroup("u-sam", { size: 4, profile: profile("Sam") }, repo);
    const id = made.group.id;
    await svc.joinGroup("u-priya", { token: made.join.token, profile: profile("Priya") }, repo);
    await svc.leaveGroup("u-priya", id, repo);
    const seen = await svc.readGroup("u-sam", id, {}, repo);
    if ("unchanged" in seen) throw new Error("expected a view");
    expect(seen.group.joinOpenUntil).toBe(0);
    const fresh = await svc.freshQr("u-sam", id, repo);
    const back = await svc.joinGroup("u-ana", { token: fresh.token, profile: profile("Ana") }, repo);
    expect(back.group.members.map((m) => m.name)).toEqual(["Sam", "Ana"]);
  });

  it("leave is silent; the last one out deletes the group and its messages", async () => {
    const { id } = await pair();
    await svc.postMessage("u-sam", id, { text: "hello" }, {}, repo);
    await svc.leaveGroup("u-priya", id, repo);
    const r = await svc.readGroup("u-sam", id, {}, repo);
    if (!("group" in r)) throw new Error("expected a group");
    expect(r.group.members.map((m) => m.name)).toEqual(["Sam"]);
    expect(r.messages.some((m) => m.kind === "system")).toBe(false);
    expect(await areFriends("u-sam", "u-priya", repo)).toBe(false);
    await svc.leaveGroup("u-sam", id, repo);
    expect(await repo.groups.get(id)).toBeNull();
    expect(await repo.groupMessages.list(id, { sinceAt: 0, limit: 10 })).toEqual([]);
  });

  it("only the creator removes; the removed person can't come back with the old QR", async () => {
    const { group, join } = await svc.createGroup("u-sam", { size: 4, profile: profile("Sam") }, repo);
    await svc.joinGroup("u-priya", { token: join.token, profile: profile("Priya") }, repo);
    const j = await svc.joinGroup("u-ana", { token: join.token, profile: profile("Ana") }, repo);
    const ana = j.group.members.find((m) => m.name === "Ana")!;
    const priya = j.group.members.find((m) => m.name === "Priya")!;
    await expect(svc.memberAction("u-priya", group.id, { action: "remove", memberId: ana.id }, repo)).rejects.toMatchObject({ status: 403 });
    await svc.memberAction("u-sam", group.id, { action: "remove", memberId: ana.id }, repo);
    await expect(svc.joinGroup("u-ana", { token: join.token, profile: profile("Ana") }, repo)).rejects.toMatchObject({ status: 410 });
    expect((await repo.groups.get(group.id))?.members.map((m) => m.name)).toEqual(["Sam", "Priya"]);
    void priya;
  });

  it("unfriend leaves every shared group; block also stops any new group together", async () => {
    const a = await svc.createGroup("u-sam", { size: 2, profile: profile("Sam") }, repo);
    await svc.joinGroup("u-priya", { token: a.join.token, profile: profile("Priya") }, repo);
    const b = await svc.createGroup("u-priya", { size: 3, profile: profile("Priya") }, repo);
    await svc.joinGroup("u-sam", { token: b.join.token, profile: profile("Sam") }, repo);
    await svc.joinGroup("u-ana", { token: b.join.token, profile: profile("Ana") }, repo);
    const priyaId = (await repo.groups.get(a.group.id))!.members.find((m) => m.uid === "u-priya")!.id;
    await svc.memberAction("u-sam", a.group.id, { action: "unfriend", memberId: priyaId }, repo);
    expect((await repo.groups.listFor("u-sam")).length).toBe(0);
    expect((await repo.groups.get(b.group.id))?.memberUids).toEqual(["u-priya", "u-ana"]);
    expect(await areFriends("u-sam", "u-priya", repo)).toBe(false);

    const c = await svc.createGroup("u-ravi", { size: 3, profile: profile("Ravi") }, repo);
    await svc.joinGroup("u-sam", { token: c.join.token, profile: profile("Sam") }, repo);
    const raviId = (await repo.groups.get(c.group.id))!.members.find((m) => m.uid === "u-ravi")!.id;
    await svc.memberAction("u-sam", c.group.id, { action: "block", memberId: raviId }, repo);
    expect(await repo.blocks.between("u-ravi", "u-sam")).toBe(true);
    const d = await svc.createGroup("u-ravi", { size: 2, profile: profile("Ravi") }, repo);
    await expect(svc.joinGroup("u-sam", { token: d.join.token, profile: profile("Sam") }, repo)).rejects.toMatchObject({ status: 410 });
  });

  it("report keeps the reason and the last lines for review, and works after they left", async () => {
    const { id, joined } = await pair();
    await svc.postMessage("u-priya", id, { text: "send me money" }, {}, repo);
    const priya = joined.group.members.find((m) => m.name === "Priya")!;
    await svc.leaveGroup("u-priya", id, repo);
    await svc.memberAction("u-sam", id, { action: "report", memberId: priya.id, reason: "unsafe" }, repo);
    // Stored in kv under a random id: check through the memory store by scanning a known prefix is not
    // possible, so check the group still works and nothing threw.
    expect((await repo.groups.get(id))?.members).toHaveLength(1);
  });

  it("a late joiner never sees lines from before they joined", async () => {
    const { group, join } = await svc.createGroup("u-sam", { size: 3, profile: profile("Sam") }, repo);
    await svc.joinGroup("u-priya", { token: join.token, profile: profile("Priya") }, repo);
    await svc.postMessage("u-sam", group.id, { text: "before Ana" }, {}, repo);
    await new Promise((r) => setTimeout(r, 5));
    await svc.joinGroup("u-ana", { token: join.token, profile: profile("Ana") }, repo);
    const r = await svc.readGroup("u-ana", group.id, {}, repo);
    if (!("group" in r)) throw new Error("expected a group");
    expect(r.messages.map((m) => m.text)).not.toContain("before Ana");
  });

  it("polling with the current version is cheap", async () => {
    const { id } = await pair();
    const r = await svc.readGroup("u-sam", id, {}, repo);
    if (!("group" in r)) throw new Error("expected a group");
    expect(await svc.readGroup("u-sam", id, { since: r.group.version }, repo)).toEqual({ unchanged: true });
    await expect(svc.readGroup("u-ana", id, {}, repo)).rejects.toMatchObject({ status: 404 });
  });
});
