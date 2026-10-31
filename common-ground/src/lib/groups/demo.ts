import "server-only";
import { createHash } from "node:crypto";
import { isDemoAccount } from "@/lib/account/session";
import { DEMO_SAM } from "@/lib/demo";
import type { Repo, StoredAccount, StoredGroup, StoredGroupMember, StoredGroupMessage } from "@/lib/db";
import { SEAT_COLORS } from "@/lib/tokens";
import type { Profile, TasteItem } from "@/lib/types";
import type { Session } from "@/lib/types/account";
import { GroupError, type OpeningDeps, joinGroup, openGroup } from "./service";
import { GROUP_COPY, GROUP_WORD } from "./shared";
import { makeJoinToken, newJoinNonce, newShortId } from "./token";

// Demo friends for judges (next-round-queue.md, "Demo friends for judges"). The ONE demo account
// (isDemoAccount, from the verified phone claim) comes with 5 made-up friends so a judge with one
// phone can try groups end to end. Demo friends:
//   - are not people: no phone, no sign-in record, uid "demo-friend-<key>", isDemoFriend on the account;
//   - are labelled "Demo friend" in every member list and chat (isDemoFriend on the member view);
//   - each carry a ready-made taste card of real Qloo entities (looked up once, cached here);
//   - only ever sit in groups with the demo account: they join only through the demo account's own
//     QR screen (server-checked here), a real person can't join a group that has one, and a group
//     left with only demo friends is deleted (service.ts);
//   - never check in, wave or switch leaderboards on, so they are on no podium and not in Open to meet.
// The demo account gets no privacy exemption toward real people.

/** The label the UI shows beside a demo friend's name, everywhere. */
export { DEMO_FRIEND_LABEL } from "./shared";

const img = (id: string) => `https://images.qloo.com/i/${id}-420x-auto.jpg`;
const pick = (id: string, name: string, domain: TasteItem["domain"], image = true): TasteItem => ({ id, name, domain, ...(image ? { image: img(id) } : {}) });

export type DemoFriendKey = "mira" | "arjun" | "hana" | "rafa" | "tara";

export interface DemoFriend {
  key: DemoFriendKey;
  name: string;
  /** Claimed as a normal username (the alias shape), so no real person can take it. */
  username: string;
  /** One easy-read line for the picker. */
  vibe: string;
  profile: Profile;
  /** The one short line this friend posts after Larry's opener (shown with the Demo friend label). */
  reply: string;
}

// Real Qloo entity ids. Most reuse picks already in the app's example cards; 3 Idiots, BTS, Stardew
// Valley, FC Barcelona, Lisbon and Huberman Lab came from six Qloo /search calls (30 Oct 2026),
// cached here so seeding never searches again.
export const DEMO_FRIENDS: readonly DemoFriend[] = [
  {
    key: "mira",
    name: "Mira",
    username: "DemoMira1",
    vibe: "Studio Ghibli and soft indie music",
    profile: {
      name: "Mira",
      items: [
        pick("9B33A620-68CA-49B3-BFCF-F09CCF8AD595", "Spirited Away", "movie"),
        pick("68CD7C41-78BE-4765-B184-1F1988036C89", "Your Name.", "movie"),
        pick("17CA60C4-D34B-4D9C-B6BC-E1CD59BDFAA5", "Fleet Foxes", "artist"),
        pick("AFBC71A7-9439-4AB0-AB68-D14B11AAF836", "Phoebe Bridgers", "artist"),
      ],
    },
    reply: "Somewhere quiet with good music works for me. I'm a demo friend, so this is my only line.",
  },
  {
    key: "arjun",
    name: "Arjun",
    username: "DemoArjun1",
    vibe: "Cricket nights and Bollywood classics",
    profile: {
      name: "Arjun",
      items: [
        pick("11E8F514-0D1A-45F8-B180-06068C4F7D29", "Mumbai Indians", "sports_team", false),
        pick("CE300FA0-0752-4DD3-B28F-FC4CFD2D8915", "3 Idiots", "movie"),
        pick("E4BF0EDE-0E1A-4FDD-A209-464004BC6659", "Moneyball", "movie"),
        pick("FAA55DC8-6030-4CC8-9BA6-4668295C3FA7", "Drake", "artist"),
      ],
    },
    reply: "Anywhere with a screen for the match works for me. I'm a demo friend, so this is my only line.",
  },
  {
    key: "hana",
    name: "Hana",
    username: "DemoHana1",
    vibe: "K-pop and cosy games",
    profile: {
      name: "Hana",
      items: [
        pick("F347D506-CB6F-46FA-9A8B-AFBC31C71A1A", "BTS", "artist"),
        pick("875DB771-9C4C-4DD0-9249-D2ABD95711F1", "Stardew Valley", "videogame"),
        pick("CDBDE254-71F0-4640-8D04-5373BEAE5278", "Minecraft", "videogame"),
        pick("9328463A-D757-43FE-A7DA-FB2DB77F0B43", "Jujutsu Kaisen", "tv_show"),
      ],
    },
    reply: "Anywhere cosy is good for me. I'm a demo friend, so this is my only line. Ask Larry for a plan.",
  },
  {
    key: "rafa",
    name: "Rafa",
    username: "DemoRafa1",
    vibe: "Football and city trips",
    profile: {
      name: "Rafa",
      items: [
        pick("AB274E13-8E14-4A39-BCB6-82977B9DB380", "FC Barcelona", "sports_team"),
        pick("F5031AA6-799B-4FC7-B38F-E23F14F1ED4C", "Lisbon", "destination", false),
        pick("DCA1F3CA-7A25-421C-BB4D-A864B6D53848", "Ted Lasso", "tv_show"),
        pick("2108A362-6EF1-4A64-8404-FDEB9FFA517F", "EA Sports FC 24", "videogame"),
      ],
    },
    reply: "I'm up for a walk and a cafe after. I'm a demo friend, so this is my only line.",
  },
  {
    key: "tara",
    name: "Tara",
    username: "DemoTara1",
    vibe: "Books and long podcasts",
    profile: {
      name: "Tara",
      items: [
        pick("C471E196-F06E-4C78-B723-6DBAE7A003B3", "The Seven Husbands of Evelyn Hugo", "book"),
        pick("10E08FC9-04BB-4827-9331-7E9ABE1F7DB6", "Huberman Lab", "podcast"),
        pick("1CDF9B1C-152D-4107-A504-BCBB939CAB54", "The Lightning Thief", "book"),
        pick("19DF9974-2931-42F7-AF6F-DC29B9E17974", "Normal People", "tv_show"),
      ],
    },
    reply: "A calm cafe with a bookshelf, please. I'm a demo friend, so this is my only line.",
  },
];

const UID_PREFIX = "demo-friend-";
export const demoFriendUid = (key: DemoFriendKey) => `${UID_PREFIX}${key}`;
export const findDemoFriend = (key: unknown) => DEMO_FRIENDS.find((f) => f.key === key);
const friendByUid = (uid: string) => DEMO_FRIENDS.find((f) => demoFriendUid(f.key) === uid);

/** The two ready-made groups: one-to-one with Hana, and a group of four. */
export const DEMO_GROUPS: readonly { slot: string; friends: DemoFriendKey[]; reply: DemoFriendKey }[] = [
  { slot: "pair", friends: ["hana"], reply: "hana" },
  { slot: "four", friends: ["mira", "arjun", "rafa"], reply: "arjun" },
];

/** A stable group id per demo account and slot (matches isGroupId), so seeding twice finds the same group. */
export const demoGroupId = (demoUid: string, slot: string) =>
  createHash("sha256").update(`larry-demo-group\u0000${demoUid}\u0000${slot}`).digest("base64url").slice(0, 22);

/** Seeding is done for this account once this key is set (a re-run, or a judge leaving a group, never re-seeds). */
const seededKey = (demoUid: string) => `demo-seeded:v1:${demoUid}`;

/* ---------------------------------------------------------------- accounts */

/** Makes the five demo-friend accounts if they are missing. Idempotent. No sign-in record, no phone. */
export async function ensureDemoFriends(repo: Repo, now = Date.now()): Promise<void> {
  for (const f of DEMO_FRIENDS) {
    const uid = demoFriendUid(f.key);
    const have = await repo.accounts.get(uid);
    if (have) {
      if (!have.isDemoFriend) await repo.accounts.update(uid, (a) => ({ ...a, isDemoFriend: true }));
      continue;
    }
    let username = f.username;
    for (let i = 2; i < 10 && !(await repo.usernames.claim(username, uid)); i++) username = f.username.replace(/\d+$/, String(i));
    const account: StoredAccount = {
      uid,
      name: f.name,
      username,
      createdAt: now,
      budgetCentsLeft: 0,
      glory: 0,
      sharingWithFriends: false,
      showOnLeaderboards: false,
      publicTitleCounts: {},
      dob: { d: 1, m: 1, y: 1998 },
      isDemoFriend: true,
    };
    await repo.accounts.create(account);
  }
}

/** True for one of the demo-friend accounts (by the stored flag, never by a request). */
export async function isDemoFriendUid(repo: Repo, uid: string): Promise<boolean> {
  if (!uid.startsWith(UID_PREFIX)) return false;
  return !!(await repo.accounts.get(uid))?.isDemoFriend;
}

/* ---------------------------------------------------------------- seeding */

function member(uid: string, name: string, username: string, profile: Profile, color: string, at: number, demoFriend: boolean): StoredGroupMember {
  return {
    id: newShortId(),
    uid,
    name,
    username,
    profile: { ...profile, name },
    color,
    joinedAt: at,
    ...(demoFriend ? { isDemoFriend: true as const } : {}),
  };
}

/** The demo account's own card in a seeded group: the ready-made demo persona's picks (as scripts/seed-demo.ts gives it). */
export const demoAccountProfile = (name: string): Profile => ({ name, items: DEMO_SAM.items });

/** Posts the friend's one canned line after Larry's opener (once per group). */
export async function postDemoReply(repo: Repo, groupId: string, key?: DemoFriendKey): Promise<boolean> {
  const g = await repo.groups.get(groupId);
  if (!g?.openedAt) return false;
  const friends = g.members.filter((m) => m.isDemoFriend);
  const m = friends.find((x) => friendByUid(x.uid)?.key === key) ?? friends[0];
  const f = m && friendByUid(m.uid);
  if (!m || !f) return false;
  const recent = await repo.groupMessages.list(groupId, { sinceAt: 0, limit: 100 });
  if (recent.some((x) => x.from === m.id && x.kind === "person")) return false;
  const at = Math.max(Date.now(), g.openedAt + 1);
  const line: StoredGroupMessage = { id: newShortId(), from: m.id, text: f.reply, at, kind: "person" };
  await repo.groupMessages.add(groupId, line);
  await repo.groups.update(groupId, (x) => {
    x.version += 1;
    x.lastAt = at;
    return x;
  });
  return true;
}

export interface SeedResult {
  /** Groups made now (0 when they already were). */
  made: number;
  /** Groups that got Larry's opening now. */
  opened: number;
  /** True when this account was already seeded and nothing changed. */
  already: boolean;
}

/**
 * Gives the demo account its two ready-made groups, each opened by Larry's real opening (openGroup,
 * the normal code: Qloo's group common ground, curated when a model is set, and the witty opener; the
 * fixed opener when the model isn't available), then one canned line from a demo friend.
 * Idempotent: stable group ids, `create` refuses a taken id, openGroup posts once, and a done flag
 * stops a second run. `reset` deletes the two groups first and seeds them fresh.
 */
export async function seedDemoWorld(
  repo: Repo,
  demoUid: string,
  opts: { opening?: OpeningDeps; reset?: boolean; now?: number; /** false: make the groups only; call openDemoGroups later. */ open?: boolean } = {},
): Promise<SeedResult> {
  const now = opts.now ?? Date.now();
  const account = await repo.accounts.get(demoUid);
  if (!account) throw new Error("The demo account doesn't exist yet. Sign in once or run the seed script.");
  if (opts.reset) {
    for (const s of DEMO_GROUPS) await repo.groups.delete(demoGroupId(demoUid, s.slot));
    await repo.kv.del(seededKey(demoUid));
  } else if (await repo.kv.get<number>(seededKey(demoUid))) {
    return { made: 0, opened: 0, already: true };
  }
  await ensureDemoFriends(repo, now);
  let made = 0;
  let opened = 0;
  for (const s of DEMO_GROUPS) {
    const id = demoGroupId(demoUid, s.slot);
    if (!(await repo.groups.get(id))) {
      const members = [member(demoUid, account.name || "You", account.username, demoAccountProfile(account.name || "You"), SEAT_COLORS[0], now, false)];
      for (const key of s.friends) {
        const f = findDemoFriend(key)!;
        const a = await repo.accounts.get(demoFriendUid(key));
        members.push(member(demoFriendUid(key), f.name, a?.username ?? f.username, f.profile, SEAT_COLORS[members.length % SEAT_COLORS.length], now, true));
      }
      const g: StoredGroup = {
        id,
        createdAt: now,
        creator: demoUid,
        size: members.length as StoredGroup["size"],
        members,
        memberUids: members.map((m) => m.uid),
        joinOpenUntil: 0,
        joinNonce: newJoinNonce(),
        departed: {},
        version: 1,
        lastAt: now,
      };
      if (await repo.groups.create(g)) made++;
    }
  }
  await repo.kv.update(seededKey(demoUid), () => now);
  if (opts.open !== false) opened = await openDemoGroups(repo, demoUid, opts.opening);
  return { made, opened, already: false };
}

/** Larry's opening for each ready-made group that has none yet, then the friend's one line. Returns how many opened now. */
export async function openDemoGroups(repo: Repo, demoUid: string, deps: OpeningDeps = {}): Promise<number> {
  let opened = 0;
  for (const s of DEMO_GROUPS) {
    const id = demoGroupId(demoUid, s.slot);
    if (await openGroup(id, deps, repo)) opened++;
    await postDemoReply(repo, id, s.reply);
  }
  return opened;
}

/* ---------------------------------------------------------------- "Let a demo friend scan it" */

export interface DemoFriendOption {
  key: DemoFriendKey;
  name: string;
  vibe: string;
  picks: string[];
}

/** Every refusal reads the same, so a real account learns nothing (as if the route weren't there). */
const notHere = () => new GroupError(404, "Not found.");

/** The open group, when the asker is the demo account and started it, and joining is open. */
async function demoGroup(repo: Repo, session: Session | null, groupId: string, now: number): Promise<StoredGroup> {
  if (!session || !isDemoAccount(session)) throw notHere();
  const g = await repo.groups.get(groupId);
  if (!g || g.creator !== session.uid || !g.memberUids.includes(session.uid)) throw notHere();
  // A real person already joined: demo friends never share a group with anyone but the demo account.
  if (g.members.some((m) => m.uid !== session.uid && !m.isDemoFriend)) throw notHere();
  if (g.joinOpenUntil <= now || g.members.length >= g.size) throw new GroupError(409, GROUP_COPY.qrClosed);
  return g;
}

/** GET: the demo friends who can scan this QR now (not already in it). Demo account, creator, joining open. */
export async function demoFriendOptions(repo: Repo, session: Session | null, groupId: string, now = Date.now()): Promise<DemoFriendOption[]> {
  const g = await demoGroup(repo, session, groupId, now);
  return DEMO_FRIENDS.filter((f) => !g.memberUids.includes(demoFriendUid(f.key))).map((f) => ({
    key: f.key,
    name: f.name,
    vibe: f.vibe,
    picks: f.profile.items.map((i) => i.name),
  }));
}

/**
 * POST: a demo friend "scans" the demo account's live QR. Server-checked: the asker's session is the
 * demo account (isDemoAccount), it started this group, joining is open, and the joiner is one of the
 * five demo friends. Then it is the normal QR join (joinGroup), so seats, the full-group close and
 * Larry's opening work exactly as for real people.
 */
export async function demoFriendScan(
  repo: Repo,
  session: Session | null,
  groupId: string,
  key: unknown,
  now = Date.now(),
): Promise<{ formed: boolean; friend: DemoFriendKey }> {
  const g = await demoGroup(repo, session, groupId, now);
  const f = findDemoFriend(key);
  if (!f) throw new GroupError(400, `Pick one of the demo friends.`);
  await ensureDemoFriends(repo, now);
  const uid = demoFriendUid(f.key);
  if (g.memberUids.includes(uid)) throw new GroupError(409, `${f.name} is already in this ${GROUP_WORD.toLowerCase()}.`);
  const token = makeJoinToken(g.id, g.joinNonce, g.joinOpenUntil);
  const { formed } = await joinGroup(uid, { token, profile: f.profile }, repo);
  return { formed, friend: f.key };
}

/** True when this demo account's ready-made groups still need seeding (cheap: one kv read). */
export async function demoNeedsSeed(repo: Repo, demoUid: string): Promise<boolean> {
  return !(await repo.kv.get<number>(seededKey(demoUid)));
}
