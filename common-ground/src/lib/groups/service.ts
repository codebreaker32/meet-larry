import "server-only";
import { type GroupChatInputPlus, cleanReply, composePlanTicket, runGroupChat, ticketOrder, withoutDistance } from "@/lib/agent";
import { type BudgetHold, holdBudget } from "@/lib/budget";
import type { GroupGround, GroupMember, GroupTurn, Persona, PersonaUpdate, PlanTicket, RunGroupChat } from "@/lib/contracts";
import { CRISIS_TEXT, looksLikeCrisis } from "@/lib/crisis";
import { type Repo, type StoredGroup, type StoredGroupMember, type StoredGroupMessage, getRepo } from "@/lib/db";
import { LARRY_COMMANDS, type LarryCommandId, parseLarryCommand } from "@/lib/larry-commands";
import { isMood } from "@/lib/mood";
import { findGroupCommonGround, findPlaces } from "@/lib/qloo";
import { cleanMessage, groundKey } from "@/lib/rooms/service";
import { NAME_MAX } from "@/lib/sanitize";
import { SEAT_COLORS } from "@/lib/tokens";
import type { Profile } from "@/lib/types";
import type { Mood, RequestSignals } from "@/lib/types/signals";
import { fallbackWitty, wittyLine } from "@/lib/witty";
import { composeOpening, openerItem, openingParts, sharedTeam, togetherText } from "./opening";
import { STEP_IN, STEP_IN_COOLDOWN_MS, type SafetyFlag, checkSafety } from "./safety";
import {
  DEMO_FRIEND_LABEL,
  GROUP_COPY,
  GROUP_MESSAGES_PAGE,
  GROUP_MESSAGE_TTL_MS,
  GROUP_QR_TTL_MS,
  GROUP_WORD,
  GROUPS_PER_PERSON_MAX,
  type GroupJoinTicket,
  type GroupMessageView,
  type GroupPollResponse,
  type GroupPreviewResponse,
  type GroupReportReason,
  type GroupSize,
  type GroupSummary,
  type GroupView,
  groupJoinPath,
} from "./shared";
import { makeJoinToken, newGroupId, newJoinNonce, newShortId, readJoinToken } from "./token";

// Groups (D25, D26): every chat is a group made by QR. 2 to 5 accounts (18+), joined by scanning the
// creator's QR, which is the consent; members are friends. Larry opens a formed group with its
// common ground and one opener, then speaks ONLY when tagged (@Larry or a /command, parsed by the
// shared larry-commands parser). Every member message passes the safety watch. No read receipts,
// typing dots, online status or unread counts. Messages are kept 30 days.

export class GroupError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const notMember = () => new GroupError(404, GROUP_COPY.notMember);
/** One answer for every QR that can't be used (expired, closed, full, blocked), except where the person needs to know. */
const qrClosed = () => new GroupError(410, GROUP_COPY.qrClosed);

/** A Larry run that hasn't finished by now was killed; its lock no longer counts. */
export const LARRY_LOCK_MS = 70_000;
/** Messages Larry reads (it answers only tags, but reads the recent chat for context). */
const LARRY_HISTORY = 30;

const repo = (r?: Repo) => r ?? getRepo();

/* ---------------------------------------------------------------- views */

function larryLocked(g: StoredGroup, now = Date.now()): boolean {
  return !!g.larryLock && now - g.larryLock.since <= LARRY_LOCK_MS;
}

export function toView(g: StoredGroup, viewerUid: string, now = Date.now()): GroupView {
  return {
    id: g.id,
    size: g.size,
    createdAt: g.createdAt,
    members: g.members.map((m) => ({
      id: m.id,
      name: m.name,
      username: m.username,
      color: m.color,
      items: m.profile.items.map((i) => ({ id: i.id, name: i.name, domain: i.domain })),
      isCreator: m.uid === g.creator,
      isMe: m.uid === viewerUid,
      ...(m.isDemoFriend ? { isDemoFriend: true } : {}),
    })),
    openSeats: Math.max(0, g.size - g.members.length),
    joinOpenUntil: joinOpen(g, now) ? g.joinOpenUntil : 0,
    opened: !!g.openedAt,
    larryAway: !!g.larryAway,
    larryBusy: larryLocked(g, now) || (!g.openedAt && !!g.openingSince && now - g.openingSince <= LARRY_LOCK_MS),
    version: g.version,
    ...(g.planTicket ? { planTicket: g.planTicket } : {}),
  };
}

function toMessageView(g: StoredGroup, m: StoredGroupMessage): GroupMessageView {
  const member = g.members.find((x) => x.id === m.from);
  const name = member?.name ?? g.departed[m.from]?.name;
  return {
    id: m.id,
    from: m.from,
    ...(name && !member ? { name } : {}),
    text: m.text,
    at: m.at,
    kind: m.kind,
    ...(m.ground ? { ground: m.ground } : {}),
    ...(m.planTicket ? { planTicket: m.planTicket } : {}),
    ...(m.places?.length ? { places: m.places } : {}),
    ...(m.cmd ? { cmd: m.cmd } : {}),
  };
}

/** Mood lines are private (older ones stored before the fix included): never shown to the group. */
const visible = (list: StoredGroupMessage[]) => list.filter((m) => m.cmd !== "mood");

const joinOpen = (g: StoredGroup, now: number) => g.joinOpenUntil > now && g.members.length < g.size;
const memberOf = (g: StoredGroup, uid: string) => g.members.find((m) => m.uid === uid);

function bump(g: StoredGroup, now = Date.now()): StoredGroup {
  g.version += 1;
  g.lastAt = now;
  return g;
}

/** "Sam", then "Sam 2" if a Sam is already here, so Larry and the others can tell them apart. */
function uniqueName(name: string, taken: string[]): string {
  const lower = new Set(taken.map((n) => n.toLowerCase()));
  if (!lower.has(name.toLowerCase())) return name;
  for (let i = 2; ; i++) {
    const c = `${name.slice(0, NAME_MAX - 2).trim()} ${i}`;
    if (!lower.has(c.toLowerCase())) return c;
  }
}

function seatColor(members: StoredGroupMember[]): string {
  const used = new Set(members.map((m) => m.color));
  return SEAT_COLORS.find((c) => !used.has(c)) ?? SEAT_COLORS[members.length % SEAT_COLORS.length];
}

export interface MemberSignals {
  mood?: Mood;
  hiddenGems?: boolean;
}

async function newMember(uid: string, profile: Profile, members: StoredGroupMember[], signals: MemberSignals | undefined, r: Repo, now: number): Promise<StoredGroupMember> {
  const account = await r.accounts.get(uid);
  if (!account) throw new GroupError(401, GROUP_COPY.needAccount);
  const name = uniqueName(account.name || profile.name || "Friend", members.map((m) => m.name));
  return {
    id: newShortId(),
    uid,
    name,
    username: account.username,
    profile: { ...profile, name },
    color: seatColor(members),
    joinedAt: now,
    ...(signals?.mood ? { mood: signals.mood } : {}),
    ...(signals?.hiddenGems !== undefined ? { hiddenGems: signals.hiddenGems } : {}),
    ...(account.isDemoFriend ? { isDemoFriend: true as const } : {}),
  };
}

function ticketFor(g: StoredGroup): GroupJoinTicket {
  const token = makeJoinToken(g.id, g.joinNonce, g.joinOpenUntil);
  return { token, path: groupJoinPath(token), expiresAt: g.joinOpenUntil };
}

async function addMessage(r: Repo, groupId: string, m: StoredGroupMessage) {
  await r.groupMessages.add(groupId, m);
}

const msg = (from: string, text: string, kind: StoredGroupMessage["kind"], at: number, extra: Partial<StoredGroupMessage> = {}): StoredGroupMessage => ({
  id: newShortId(),
  from,
  text,
  at,
  kind,
  ...extra,
});

/* ---------------------------------------------------------------- create, join, read */

export async function createGroup(
  uid: string,
  input: { size: GroupSize; profile: Profile; signals?: MemberSignals },
  r?: Repo,
): Promise<{ group: GroupView; join: GroupJoinTicket }> {
  const db = repo(r);
  if ((await db.groups.listFor(uid)).length >= GROUPS_PER_PERSON_MAX) throw new GroupError(409, GROUP_COPY.tooMany);
  const now = Date.now();
  const me = await newMember(uid, input.profile, [], input.signals, db, now);
  for (let i = 0; i < 4; i++) {
    const g: StoredGroup = {
      id: newGroupId(),
      createdAt: now,
      creator: uid,
      size: input.size,
      members: [me],
      memberUids: [uid],
      joinOpenUntil: now + GROUP_QR_TTL_MS,
      joinNonce: newJoinNonce(),
      departed: {},
      version: 1,
      lastAt: now,
    };
    if (await db.groups.create(g)) return { group: toView(g, uid, now), join: ticketFor(g) };
  }
  throw new Error("Couldn't find a free group id");
}

/** Checks a QR for this person without changing anything. Throws the warm reason when it can't be used. */
async function usableGroup(uid: string, token: unknown, db: Repo, now: number): Promise<StoredGroup> {
  const claims = readJoinToken(token);
  if (!claims) throw qrClosed();
  const g = await db.groups.get(claims.groupId);
  if (!g) throw qrClosed();
  if (memberOf(g, uid)) return g;
  if (claims.expiresAt <= now) throw new GroupError(410, GROUP_COPY.qrExpired);
  if (claims.nonce !== g.joinNonce || g.joinOpenUntil <= now) throw qrClosed();
  if (g.members.length >= g.size) throw new GroupError(409, GROUP_COPY.qrFull);
  // Blocked either way: the same answer as a closed QR, so a block is never revealed.
  for (const m of g.members) if (await db.blocks.between(uid, m.uid)) throw qrClosed();
  // Demo friends live only in the demo account's groups (groups/demo.ts): a real person can't join one.
  if (g.members.some((m) => m.isDemoFriend) && !(await db.accounts.get(uid))?.isDemoFriend) throw qrClosed();
  return g;
}

export async function previewJoin(uid: string, token: unknown, r?: Repo): Promise<GroupPreviewResponse> {
  const db = repo(r);
  const g = await usableGroup(uid, token, db, Date.now());
  return { names: g.members.map((m) => m.name), openSeats: Math.max(0, g.size - g.members.length), size: g.size };
}

/**
 * Joins by QR. Idempotent for someone already in. When the group becomes full, joining closes and
 * `formed` is true: the caller asks Larry to open it (openGroup), after the response.
 */
export async function joinGroup(
  uid: string,
  input: { token: unknown; profile: Profile; signals?: MemberSignals },
  r?: Repo,
): Promise<{ group: GroupView; formed: boolean }> {
  const db = repo(r);
  const now = Date.now();
  const before = await usableGroup(uid, input.token, db, now);
  if (memberOf(before, uid)) return { group: toView(before, uid, now), formed: false };
  if ((await db.groups.listFor(uid)).length >= GROUPS_PER_PERSON_MAX) throw new GroupError(409, GROUP_COPY.tooMany);
  const claims = readJoinToken(input.token)!;
  const draft = await newMember(uid, input.profile, before.members, input.signals, db, now);
  let formed = false;
  const g = await db.groups.update(before.id, (x) => {
    formed = false; // a retried transaction starts clean
    if (memberOf(x, uid)) return null;
    if (claims.nonce !== x.joinNonce || x.joinOpenUntil <= now) throw qrClosed();
    if (x.members.length >= x.size) throw new GroupError(409, GROUP_COPY.qrFull);
    const member = { ...draft, name: uniqueName(draft.name, x.members.map((m) => m.name)), color: seatColor(x.members) };
    member.profile = { ...member.profile, name: member.name };
    x.members.push(member);
    x.memberUids = x.members.map((m) => m.uid);
    if (x.members.length >= x.size) {
      // Full: the QR stops working, and Larry opens the group.
      x.joinOpenUntil = 0;
      x.joinNonce = newJoinNonce();
      formed = !x.openedAt;
    }
    return bump(x, now);
  });
  if (!g) throw qrClosed();
  return { group: toView(g, uid, now), formed };
}

/** True when the group should get Larry's opening now: 2+ people, joining over (full, closed or timed out), none yet. */
export function needsOpening(g: StoredGroup, now = Date.now()): boolean {
  if (g.openedAt || g.members.length < 2) return false;
  if (g.openingSince && now - g.openingSince <= LARRY_LOCK_MS) return false;
  return !joinOpen(g, now);
}

/**
 * For a member: the group and its latest messages, or { unchanged } when `since` is the current
 * version. Messages from before this member joined, or older than 30 days, are never returned.
 * `onNeedsOpening` fires when the joining window ended without a full group (Larry still opens it).
 */
export async function readGroup(
  uid: string,
  id: string,
  opts: { since?: number; onNeedsOpening?: () => void } = {},
  r?: Repo,
): Promise<GroupPollResponse> {
  const db = repo(r);
  const g = await db.groups.get(id);
  const me = g && memberOf(g, uid);
  if (!g || !me) throw notMember();
  const now = Date.now();
  if (opts.onNeedsOpening && needsOpening(g, now)) opts.onNeedsOpening();
  if (opts.since !== undefined && opts.since === g.version) return { unchanged: true };
  const sinceAt = Math.max(now - GROUP_MESSAGE_TTL_MS, me.joinedAt);
  const messages = await db.groupMessages.list(id, { sinceAt, limit: GROUP_MESSAGES_PAGE });
  return { group: toView(g, uid, now), messages: visible(messages).map((m) => toMessageView(g, m)) };
}

export async function listGroups(uid: string, r?: Repo): Promise<GroupSummary[]> {
  const db = repo(r);
  return (await db.groups.listFor(uid))
    .sort((a, b) => b.lastAt - a.lastAt)
    .map((g) => ({
      id: g.id,
      size: g.size,
      names: g.members.filter((m) => m.uid !== uid).map((m) => (m.isDemoFriend ? `${m.name} (${DEMO_FRIEND_LABEL})` : m.name)),
      openSeats: Math.max(0, g.size - g.members.length),
      lastAt: g.lastAt,
      ...(g.planTicket ? { plan: `${g.planTicket.place.name}${g.planTicket.when ? `, ${g.planTicket.when}` : ""}` } : {}),
    }));
}

/* ---------------------------------------------------------------- the creator's controls */

function requireCreator(g: StoredGroup, uid: string) {
  if (!memberOf(g, uid)) throw notMember();
  if (g.creator !== uid) throw new GroupError(403, GROUP_COPY.creatorOnly);
}

/** A fresh QR for 15 minutes (creator only, not full). Every earlier QR stops working. */
export async function freshQr(uid: string, id: string, r?: Repo): Promise<GroupJoinTicket> {
  const db = repo(r);
  const now = Date.now();
  const g = await db.groups.update(id, (x) => {
    requireCreator(x, uid);
    if (x.members.length >= x.size) throw new GroupError(409, GROUP_COPY.qrFull);
    x.joinOpenUntil = now + GROUP_QR_TTL_MS;
    x.joinNonce = newJoinNonce();
    return bump(x, now);
  });
  if (!g) throw notMember();
  return ticketFor(g);
}

/** Closes joining (creator only). Larry opens the group if it has 2+ people and no opening yet. */
export async function closeJoining(uid: string, id: string, r?: Repo): Promise<{ group: GroupView; formed: boolean }> {
  const db = repo(r);
  const now = Date.now();
  const g = await db.groups.update(id, (x) => {
    requireCreator(x, uid);
    x.joinOpenUntil = 0;
    x.joinNonce = newJoinNonce();
    return bump(x, now);
  });
  if (!g) throw notMember();
  return { group: toView(g, uid, now), formed: needsOpening(g, now) };
}

/* ---------------------------------------------------------------- leaving, removing, people */

/**
 * Takes a member out (leave, remove, unfriend, block). Silent: no message to anyone. The creator
 * role passes to the longest-standing member; the last one out deletes the group and its messages.
 * Any open QR is cancelled, so the removed person can't come back in with it.
 */
async function takeOut(db: Repo, id: string, uid: string): Promise<void> {
  let empty = false;
  const g = await db.groups.update(id, (x) => {
    const m = memberOf(x, uid);
    if (!m) return null;
    x.departed = { ...x.departed, [m.id]: { name: m.name, uid: m.uid } };
    x.members = x.members.filter((y) => y.uid !== uid);
    x.memberUids = x.members.map((y) => y.uid);
    x.joinNonce = newJoinNonce();
    // The old QR is dead now: show joining as closed, so the creator gets "Show QR" for a fresh one.
    x.joinOpenUntil = 0;
    if (x.creator === uid && x.members[0]) x.creator = x.members[0].uid;
    // Only demo friends left (the demo account left): the group goes, demo friends are never alone or with others.
    empty = x.members.every((y) => y.isDemoFriend);
    return bump(x);
  });
  if (g && empty) await db.groups.delete(id);
}

export async function leaveGroup(uid: string, id: string, r?: Repo): Promise<void> {
  const db = repo(r);
  const g = await db.groups.get(id);
  if (!g || !memberOf(g, uid)) throw notMember();
  await takeOut(db, id, uid);
}

/** The uid behind a per-group member id (members and people who left), for the member actions. */
async function targetUid(db: Repo, uid: string, id: string, memberId: string): Promise<{ g: StoredGroup; target: string }> {
  const g = await db.groups.get(id);
  if (!g || !memberOf(g, uid)) throw notMember();
  const target = g.members.find((m) => m.id === memberId)?.uid ?? g.departed[memberId]?.uid;
  if (!target || target === uid) throw new GroupError(404, "We couldn't find that person here.");
  return { g, target };
}

/** Creator only: removes a member. Silent. */
export async function removeMember(uid: string, id: string, memberId: string, r?: Repo): Promise<void> {
  const db = repo(r);
  const { g, target } = await targetUid(db, uid, id, memberId);
  requireCreator(g, uid);
  await takeOut(db, id, target);
}

/** Unfriend: you leave every group you share with them, so the friendship is gone. Silent. */
export async function unfriend(uid: string, otherUid: string, r?: Repo): Promise<void> {
  const db = repo(r);
  if (uid === otherUid) return;
  const shared = (await db.groups.listFor(uid)).filter((g) => g.memberUids.includes(otherUid));
  for (const g of shared) await takeOut(db, g.id, uid);
}

/** Block: unfriend, and the two can never share a group again. Never revealed to them. */
export async function block(uid: string, otherUid: string, r?: Repo): Promise<void> {
  const db = repo(r);
  if (uid === otherUid) return;
  await db.blocks.add(uid, otherUid);
  await unfriend(uid, otherUid, db);
}

/** Report reasons are kept for review for 30 days, with the last messages of the group if given. */
export const REPORT_TTL_MS = 30 * 24 * 3600 * 1000;

export async function report(
  uid: string,
  otherUid: string,
  input: { reason: GroupReportReason; note?: string; groupId?: string },
  r?: Repo,
): Promise<void> {
  const db = repo(r);
  let messages: { from: "reported" | "reporter" | "larry" | "other"; text: string }[] = [];
  if (input.groupId) {
    const g = await db.groups.get(input.groupId);
    if (g && (memberOf(g, uid) || Object.values(g.departed).some((d) => d.uid === uid))) {
      const idOf = (u: string) => [...g.members.map((m) => [m.id, m.uid] as const), ...Object.entries(g.departed).map(([k, v]) => [k, v.uid] as const)].find(([, x]) => x === u)?.[0];
      const mine = idOf(uid);
      const theirs = idOf(otherUid);
      const list = await db.groupMessages.list(g.id, { sinceAt: Date.now() - GROUP_MESSAGE_TTL_MS, limit: 20 });
      messages = list.map((m) => ({
        from: m.from === "larry" || m.from === "system" ? "larry" : m.from === theirs ? "reported" : m.from === mine ? "reporter" : "other",
        text: m.text,
      }));
    }
  }
  const id = newShortId();
  await db.kv.update(`group-report:${id}`, () => ({ id, at: Date.now(), reporter: uid, reported: otherUid, reason: input.reason, ...(input.note ? { note: input.note.slice(0, 300) } : {}), messages }), REPORT_TTL_MS);
}

/** Member actions from inside a group (by per-group member id). */
export async function memberAction(
  uid: string,
  id: string,
  input: { action: "remove" | "unfriend" | "block" | "report"; memberId: string; reason?: GroupReportReason; note?: string },
  r?: Repo,
): Promise<void> {
  const db = repo(r);
  if (input.action === "remove") return removeMember(uid, id, input.memberId, db);
  const { target } = await targetUid(db, uid, id, input.memberId);
  if (input.action === "unfriend") return unfriend(uid, target, db);
  if (input.action === "block") return block(uid, target, db);
  return report(uid, target, { reason: input.reason ?? "other", ...(input.note ? { note: input.note } : {}), groupId: id }, db);
}

/** Account deletion: leave every group (the last one out deletes it) and drop blocks. */
export async function forgetGroupsOf(uid: string, r?: Repo): Promise<void> {
  const db = repo(r);
  for (const g of await db.groups.listFor(uid)) await takeOut(db, g.id, uid);
  await db.blocks.removeAll(uid);
}

/* ---------------------------------------------------------------- Larry's opening */

export type GroundFind = (members: GroupMember[], signals?: RequestSignals) => Promise<GroupGround>;

export interface OpeningDeps {
  /** How the ground is found (Qloo, curated and charged to the request's account when it has Larry time). */
  find?: GroundFind;
  /** Charge for the opener line's model call; without it the opener is the fixed fallback (no uncharged calls). */
  charge?: (usd: number) => void | Promise<void>;
  /** Use the fixed opener only (e2e). */
  fixedOpener?: boolean;
}

export const toGroupMember = (m: StoredGroupMember): GroupMember => ({ id: m.id, name: m.name, profile: m.profile, color: m.color });

/** Hidden Gems when at least half the group has it on; never anyone's age. */
function groupSignals(g: StoredGroup): RequestSignals | undefined {
  const on = g.members.filter((m) => m.hiddenGems).length;
  return g.members.length && on * 2 >= g.members.length ? { hiddenGems: true } : undefined;
}

async function opener(ground: GroupGround | undefined, deps: OpeningDeps): Promise<string> {
  const item = openerItem(ground);
  const items = item ? [{ name: item.name, kind: item.kind }] : [];
  if (deps.fixedOpener || !deps.charge) return fallbackWitty("opener", items).line;
  try {
    return (await wittyLine("opener", items, { budget: { charge: deps.charge } })).line;
  } catch {
    return fallbackWitty("opener", items).line;
  }
}

/**
 * Posts Larry's opening once: the group's common ground (attached, so the chat shows "Why this?"
 * with whose picks led there), at most one extra and an easy opener, under 90 words. Safe to call
 * twice: a lock and openedAt make the second call do nothing. Never throws.
 */
export async function openGroup(id: string, deps: OpeningDeps = {}, r?: Repo): Promise<boolean> {
  const db = repo(r);
  const now = Date.now();
  let mine = false;
  const locked = await db.groups.update(id, (x) => {
    mine = false;
    if (!needsOpening(x, now)) return null;
    x.openingSince = now;
    mine = true;
    return x;
  });
  if (!locked || !mine) return false;
  try {
    const members = locked.members.map(toGroupMember);
    const find: GroundFind = deps.find ?? ((m, s) => findGroupCommonGround(m, undefined, { curate: false, ...(s ? { signals: s } : {}) }));
    let ground: GroupGround | undefined;
    try {
      ground = await find(members, groupSignals(locked));
    } catch (err) {
      console.error("Group opening ground failed:", err instanceof Error ? err.message : err);
    }
    const line = await opener(ground, deps);
    const { text, extraKind } = composeOpening(openingParts(members, ground, line));
    const at = Date.now();
    const key = groundKey(locked.members.map((m) => ({ ...toGroupMember(m), joinedAt: 0, lastSeenAt: 0 })));
    await addMessage(db, id, msg("larry", text, "opening", at, { ...(ground ? { ground } : {}), ...(extraKind ? { cmd: `opening:${extraKind}` } : {}) }));
    await db.groups.update(id, (x) => {
      x.openedAt = at;
      delete x.openingSince;
      if (ground) {
        x.ground = ground;
        x.groundKey = key;
      }
      return bump(x, at);
    });
    return true;
  } catch (err) {
    console.error("Group opening failed:", err instanceof Error ? err.message : err);
    await db.groups.update(id, (x) => {
      delete x.openingSince;
      return x;
    }).catch(() => undefined);
    return false;
  }
}

/* ---------------------------------------------------------------- messages and tags */

export interface PostInput {
  text: string;
  /** The asker's coarse stored location (about 1 km), for /plan and places. Never stored or shown. */
  location?: { lat: number; lon: number };
  persona?: Persona;
  signals?: MemberSignals;
}

export interface PostResult {
  group: GroupView;
  messages: GroupMessageView[];
  crisis?: true;
  personaUpdate?: PersonaUpdate;
  /** A line from Larry for the sender only (never stored, never seen by the group): the /mood answer. */
  privateNote?: string;
  /**
   * The sender's phone sent no location and Larry needed one for places: the client offers a
   * one-tap "Share location" next to the note.
   */
  needsLocation?: true;
}

/** Larry's line, to the sender only, when a plan needs places and this phone has no location. */
export const NO_LOCATION_NOTE =
  "I'd love to find a real place for you all, but I don't know roughly where you are yet. Share your location (only about 1 km, and only I see it), then I'll make the plan.";

export interface RunCharge {
  wrap: (hold: BudgetHold) => BudgetHold;
  charge?: (usd: number) => void | Promise<void>;
}

export interface PostOptions {
  /** Throws when over a rate limit. */
  limit?: (kind: "message" | "larry" | "crisis") => void;
  /** Checks the asker's Larry time (account budget) and returns how to charge the run. Throws to refuse. */
  authorize?: () => Promise<RunCharge>;
  runGroupChat?: RunGroupChat;
  find?: GroundFind;
  fixedOpener?: boolean;
  /** Places for the /plan fallback (tests). */
  findPlaces?: typeof findPlaces;
}

const HELP_TEXT = [
  "I stay quiet until you tag me. Tap @Larry or type / to pick:",
  ...LARRY_COMMANDS.map((c) => `/${c.cmd}: ${c.hint}.`),
  "Or just ask: \"@Larry where should we go Saturday?\"",
].join("\n");

const MOOD_WORDS: Record<string, Mood> = {
  chill: "chill",
  calm: "chill",
  social: "social",
  curious: "curious",
  low: "low-energy",
  lowenergy: "low-energy",
  tired: "low-energy",
  hype: "hype",
  hyped: "hype",
};

function moodFrom(arg: string): Mood | null {
  const w = arg.toLowerCase().replace(/[^a-z]/g, "");
  if (isMood(arg.trim().toLowerCase())) return arg.trim().toLowerCase() as Mood;
  return MOOD_WORDS[w] ?? MOOD_WORDS[w.slice(0, 3)] ?? null;
}

/** Commands Larry answers without a model call. */
const NO_MODEL: LarryCommandId[] = ["help", "excuse", "hello", "rising"];

/** What the model is asked to do for each command, as a note after the person's line. */
function commandNote(cmd: LarryCommandId | "ask", asker: string, args: string, g: StoredGroup): string {
  const extra = args ? ` They added: "${args.slice(0, 200)}".` : "";
  switch (cmd) {
    case "plan":
      return `(${asker} tapped Plan. Make ONE Plan Ticket for everyone in this ${GROUP_WORD.toLowerCase()} now: call find_places_nearby, then make_plan_ticket with the place that fits everyone, a thing from the common ground to bring up, and an easy opener. Then one short line.${extra})`;
    case "gems":
      return `(${asker} tapped Gems. Recommend one or two less-known things the whole group would like (call recommend), saying whose picks led there. Then offer a plan.${extra})`;
    case "twin":
      return `(${asker} tapped Twin. Find ${asker}'s taste twin in a category ${asker} has no picks in: call recommend for ${asker} in that domain, name one result and which of ${asker}'s picks led there, and how the group could try it together.${extra})`;
    case "matchday": {
      const team = sharedTeam(g.ground);
      return `(${asker} tapped Match Day. They share ${team}. Suggest watching ${team}'s next game together at a calm place with a screen, ending by about 10 pm, with a daytime highlights plan as plan B. There is NO verified fixture: never give a date, time or opponent for a game. If location is shared, make a Plan Ticket.${extra})`;
    }
    default:
      return "";
  }
}

/** Messages as chat turns for Larry: only lines Larry may read (not excused, after it came back). */
function historyFor(g: StoredGroup, list: StoredGroupMessage[]): GroupTurn[] {
  const nameOf = (id: string) => g.members.find((m) => m.id === id)?.name ?? g.departed[id]?.name ?? "Someone who left";
  return list
    .filter((m) => !m.excused && m.kind !== "system" && m.cmd !== "mood" && (g.larryBackAt === undefined || m.at >= g.larryBackAt))
    .slice(-LARRY_HISTORY)
    .map((m) => (m.from === "larry" ? { role: "assistant", content: m.text } : { role: "user", content: `[${nameOf(m.from)}] ${m.text}` }));
}

async function finish(db: Repo, g: StoredGroup, uid: string, extra: Partial<PostResult> = {}): Promise<PostResult> {
  const me = memberOf(g, uid)!;
  const sinceAt = Math.max(Date.now() - GROUP_MESSAGE_TTL_MS, me.joinedAt);
  const messages = await db.groupMessages.list(g.id, { sinceAt, limit: GROUP_MESSAGES_PAGE });
  return { group: toView(g, uid), messages: visible(messages).map((m) => toMessageView(g, m)), ...extra };
}

/**
 * Adds a member's message. Order: crisis (Larry's fixed help reply, no model, always), then the
 * safety watch (Larry steps in warmly, once per flag per cooldown; that is Larry's whole answer),
 * then tags: Larry answers ONLY a line that starts with @Larry or a /command. Untagged lines never
 * get a reply. While Larry is excused, lines are kept from it until /hello.
 */
export async function postMessage(uid: string, id: string, input: PostInput, opts: PostOptions = {}, r?: Repo): Promise<PostResult> {
  const db = repo(r);
  const current = await db.groups.get(id);
  const me = current && memberOf(current, uid);
  if (!current || !me) throw notMember();
  const text = cleanMessage(input.text);
  if (!text) throw new GroupError(400, GROUP_COPY.empty);
  const now = Date.now();
  const crisis = looksLikeCrisis(input.text.slice(0, 2000)) || looksLikeCrisis(text);

  if (crisis) {
    try {
      opts.limit?.("crisis");
    } catch {
      return finish(db, current, uid, { crisis: true });
    }
    await addMessage(db, id, msg(me.id, text, "person", now));
    await addMessage(db, id, msg("larry", CRISIS_TEXT, "care", now + 1));
    const g = (await db.groups.update(id, (x) => bump(x, now))) ?? current;
    return finish(db, g, uid, { crisis: true });
  }

  const parsed = parseLarryCommand(text);
  const toLarry = parsed.kind !== "none";
  const cmd: LarryCommandId | "ask" | null = parsed.kind === "command" ? parsed.cmd : parsed.kind === "ask" ? "ask" : null;
  const args = parsed.kind === "command" ? parsed.args : "";
  opts.limit?.("message");

  // Mood is private: the line is never stored or shown, only the member's mood is kept, and the
  // answer goes back to the sender alone. Larry never sees whose mood it is.
  if (cmd === "mood") return privateMood(db, current, uid, args);

  // Away: kept from Larry, no reply, until someone says /hello.
  const away = !!current.larryAway && cmd !== "hello";
  // The @Larry tag itself looks like a social handle to the watch: check only what follows it.
  const safety = await checkSafety(text.replace(/^@larry\b[\s,:;.!-]*/i, ""));
  const flag: SafetyFlag | null = safety.flag;

  await addMessage(db, id, msg(me.id, text, "person", now, { ...(toLarry ? { toLarry: true } : {}), ...(away ? { excused: true } : {}), ...(cmd ? { cmd } : {}) }));
  let steppedIn = false;
  let g = await db.groups.update(id, (x) => {
    if (input.signals) {
      const m = memberOf(x, uid);
      if (m) {
        if (input.signals.mood) m.mood = input.signals.mood;
        if (input.signals.hiddenGems !== undefined) m.hiddenGems = input.signals.hiddenGems;
      }
    }
    steppedIn = false;
    if (flag) {
      x.flagsAt ??= {};
      if (now - (x.flagsAt[flag] ?? 0) >= STEP_IN_COOLDOWN_MS) {
        x.flagsAt[flag] = now;
        steppedIn = true;
      }
    }
    return bump(x, now);
  });
  if (!g) throw notMember();
  if (steppedIn && flag) {
    await addMessage(db, id, msg("larry", STEP_IN[flag], "care", now + 1));
    g = (await db.groups.update(id, (x) => bump(x))) ?? g;
    return finish(db, g, uid);
  }
  if (!toLarry || away || !cmd) return finish(db, g, uid);

  opts.limit?.("larry");

  // Commands with no model call.
  if (NO_MODEL.includes(cmd as LarryCommandId)) {
    const reply = await quickReply(db, g, cmd as LarryCommandId);
    return finish(db, reply, uid);
  }
  if (cmd === "matchday" && !sharedTeam(g.ground)) {
    const out = await larrySays(db, id, "None of you share a team I can find on your cards yet. Want a calm plan from what you do share? Tag me with /plan.", "matchday");
    return finish(db, out ?? g, uid);
  }
  // Only when the sender's phone truly sent no point: the answer goes to them alone (where they
  // are is nobody else's business), with a one-tap "Share location" on their phone.
  if ((cmd === "plan" || cmd === "matchday") && !input.location) {
    return finish(db, g, uid, { privateNote: NO_LOCATION_NOTE, needsLocation: true });
  }
  if (!opts.runGroupChat && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    const out = await larrySays(db, id, "I can't think right now. Try again in a little while.", cmd);
    return finish(db, out ?? g, uid);
  }

  const auth = opts.authorize ? await opts.authorize() : undefined;
  const held = await holdBudget();
  // Wrapping also holds the access code's run lease: released in finally on every path, /together included.
  const budget = auth ? auth.wrap(held) : held;
  try {
    if (cmd === "together") return await together(db, g, uid, auth, opts);
    return await runLarry(db, g, uid, me, cmd, args, input, opts, budget, auth?.charge);
  } finally {
    budget.release();
  }
}

async function larrySays(db: Repo, id: string, text: string, cmd: string, extra: Partial<StoredGroupMessage> = {}): Promise<StoredGroup | null> {
  const at = Date.now();
  await addMessage(db, id, msg("larry", text, "larry", at, { cmd, ...extra }));
  return db.groups.update(id, (x) => bump(x, at));
}

async function quickReply(db: Repo, g: StoredGroup, cmd: LarryCommandId): Promise<StoredGroup> {
  const id = g.id;
  if (cmd === "help") return (await larrySays(db, id, HELP_TEXT, cmd)) ?? g;
  if (cmd === "rising") {
    // Honest miss: nothing verified as climbing (never "rising in <city>").
    return (
      (await larrySays(db, id, "Nothing I can vouch for as climbing near you right now. Want a plan from what you all already like? Tag me with /plan.", cmd)) ?? g
    );
  }
  if (cmd === "excuse") {
    const at = Date.now();
    await addMessage(db, id, msg("larry", "I'll step out. Say /hello when you want me back.", "larry", at, { cmd }));
    const out = await db.groups.update(id, (x) => {
      x.larryAway = true;
      return bump(x, at);
    });
    return out ?? g;
  }
  if (cmd === "hello") {
    const at = Date.now();
    const wasAway = !!g.larryAway;
    await addMessage(db, id, msg("larry", wasAway ? "I'm back. Tag me with @Larry or pick from the menu." : "Hi! I'm here. Tag me with @Larry or pick from the menu.", "larry", at, { cmd }));
    return (
      (await db.groups.update(id, (x) => {
        if (x.larryAway) {
          delete x.larryAway;
          x.larryBackAt = at;
        }
        return bump(x, at);
      })) ?? g
    );
  }
  return g;
}

/** "/mood": kept on the member server-side only; the reply is for the sender alone. */
async function privateMood(db: Repo, g: StoredGroup, uid: string, args: string): Promise<PostResult> {
  const mood = moodFrom(args);
  if (!mood) return finish(db, g, uid, { privateNote: "How are you feeling? Try /mood chill, /mood social, /mood curious, /mood low energy or /mood hype." });
  const out = await db.groups.update(g.id, (x) => {
    const m = memberOf(x, uid);
    if (m) m.mood = mood;
    return x;
  });
  return finish(db, out ?? g, uid, { privateNote: "Got it, just between us. I'll count it in when I pick a place, without saying whose it is." });
}

/** "/together": Larry's curated common ground for the members now (one curation call, charged to the asker). */
async function together(db: Repo, g: StoredGroup, uid: string, auth: RunCharge | undefined, opts: PostOptions): Promise<PostResult> {
  const members = g.members.map(toGroupMember);
  const signals = groupSignals(g);
  const find: GroundFind =
    opts.find ??
    ((m, s) => findGroupCommonGround(m, undefined, { ...(auth?.charge ? { charge: auth.charge } : { curate: false }), ...(s ? { signals: s } : {}) }));
  let ground: GroupGround | undefined;
  try {
    ground = await find(members, signals);
  } catch (err) {
    console.error("Group common ground failed:", err instanceof Error ? err.message : err);
  }
  if (!ground) return finish(db, (await larrySays(db, g.id, "Larry's a little busy finding things right now. Try /together again in a minute?", "together")) ?? g, uid);
  const line = await opener(ground, { ...(auth?.charge ? { charge: auth.charge } : {}), ...(opts.fixedOpener ? { fixedOpener: true } : {}) });
  const text = togetherText(members, ground, line);
  const at = Date.now();
  await addMessage(db, g.id, msg("larry", text, "larry", at, { cmd: "together", ground }));
  const out = await db.groups.update(g.id, (x) => {
    x.ground = ground;
    x.groundKey = groundKey(x.members.map((m) => ({ ...toGroupMember(m), joinedAt: 0, lastSeenAt: 0 })));
    return bump(x, at);
  });
  return finish(db, out ?? g, uid);
}

/** A Plan Ticket from real data when the model didn't make one: Qloo places near the asker, the lead item. */
async function fallbackTicket(g: StoredGroup, location: { lat: number; lon: number }, find: typeof findPlaces): Promise<PlanTicket | undefined> {
  try {
    const items = g.members.flatMap((m) => m.profile.items).slice(0, 25);
    const places = await find(items, location.lat, location.lon, { take: 6 });
    const place = ticketOrder(places, g.id)[0];
    if (!place) return undefined;
    const refs = [...(g.ground?.bridges ?? []), ...(g.ground?.shared.map((s) => s.item) ?? []), ...items];
    const lead = refs[0];
    const made = composePlanTicket({ place_id: place.id, ...(lead ? { item: lead.name } : {}) }, { places, items: refs, whoOf: new Map() });
    if ("error" in made) return undefined;
    return { ...made.ticket, place: withoutDistance(made.ticket.place) };
  } catch (err) {
    console.error("Group Plan Ticket fallback failed:", err instanceof Error ? err.message : err);
    return undefined;
  }
}

async function runLarry(
  db: Repo,
  g: StoredGroup,
  uid: string,
  me: StoredGroupMember,
  cmd: LarryCommandId | "ask",
  args: string,
  input: PostInput,
  opts: PostOptions,
  budget: BudgetHold,
  charge?: (usd: number) => void | Promise<void>,
): Promise<PostResult> {
  const id = g.id;
  const lockId = newShortId();
  let locked = false;
  const started = Date.now();
  const posted = await db.groups.update(id, (x) => {
    locked = false;
    if (larryLocked(x, started)) return null;
    x.larryLock = { id: lockId, since: started };
    locked = true;
    return bump(x, started);
  });
  if (!posted) throw notMember();
  // Larry is already answering someone; it will read this line next time.
  if (!locked) return finish(db, posted, uid);
  const release = (x: StoredGroup) => {
    if (x.larryLock?.id !== lockId) return false;
    delete x.larryLock;
    return true;
  };
  try {
    // Larry reads only what every member now could read: nothing from before the latest joiner came in.
    const lastJoin = Math.max(0, ...posted.members.map((m) => m.joinedAt));
    const recent = await db.groupMessages.list(id, { sinceAt: Math.max(Date.now() - GROUP_MESSAGE_TTL_MS, posted.larryBackAt ?? 0, lastJoin), limit: 60 });
    const history = historyFor(posted, recent);
    const note = commandNote(cmd, me.name, args, posted);
    if (note && history.length && history.at(-1)!.role === "user") history[history.length - 1] = { role: "user", content: `${history.at(-1)!.content}\n${note}` };
    const moods = posted.members.map((m) => m.mood).filter((m): m is Mood => !!m);
    const signals = cmd === "gems" ? { hiddenGems: true } : groupSignals(posted);
    const chatInput: GroupChatInputPlus = {
      mode: "group",
      members: posted.members.map(toGroupMember),
      history,
      ...(input.location ? { location: input.location } : {}),
      ...(posted.ground ? { ground: posted.ground } : {}),
      ...(input.persona ? { personas: { [me.id]: input.persona } } : {}),
      ...(moods.length ? { roomMoods: moods } : {}),
      ...(signals ? { signals } : {}),
    };
    const result = await (opts.runGroupChat ?? runGroupChat)(chatInput, undefined, { budget, ...(charge ? { charge } : {}) });
    let ticket = result.planTicket ? { ...result.planTicket, place: withoutDistance(result.planTicket.place) } : undefined;
    if (!ticket && (cmd === "plan" || cmd === "matchday") && input.location) ticket = await fallbackTicket(posted, input.location, opts.findPlaces ?? findPlaces);
    if (ticket && cmd === "matchday") ticket = { ...ticket, variant: "matchday" };
    let text = result.quiet ? "" : result.messages.map((m) => cleanReply(m.text).slice(0, 2000)).filter(Boolean).join("\n");
    if (!text) text = ticket ? "Here's a plan for all of you." : "I'm here. Try /plan for a Plan Ticket, or ask me about what you all like.";
    const places = (result.places ?? []).slice(0, 6).map(withoutDistance);
    const at = Date.now();
    await addMessage(db, id, msg("larry", text, "larry", at, { cmd, ...(ticket ? { planTicket: ticket } : {}), ...(places.length ? { places } : {}) }));
    const done = await db.groups.update(id, (x) => {
      release(x);
      if (ticket) x.planTicket = ticket;
      if (result.ground && !result.profileUpdates.length) x.ground = result.ground;
      return bump(x, at);
    });
    const learned = input.persona ? result.personaUpdates?.[me.id] : undefined;
    // No point from this phone and Larry brought up location: offer the one-tap share to the sender.
    const askedForLocation = !input.location && !ticket && /\blocation\b/i.test(text);
    return finish(db, done ?? posted, uid, {
      ...(learned ? { personaUpdate: learned } : {}),
      ...(askedForLocation ? { needsLocation: true as const } : {}),
    });
  } catch (err) {
    await db.groups.update(id, (x) => (release(x) ? bump(x) : null)).catch(() => undefined);
    throw err;
  }
}

/** Deletes messages older than 30 days in this group (called now and then on posting). */
export async function pruneOld(id: string, r?: Repo): Promise<void> {
  await repo(r).groupMessages.prune(id, Date.now() - GROUP_MESSAGE_TTL_MS);
}
