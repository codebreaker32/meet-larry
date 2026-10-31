import "server-only";
import { randomBytes } from "node:crypto";
import { type GroupChatInputPlus, cleanReply, runGroupChat, withoutDistance } from "@/lib/agent";
import { type BudgetHold, holdBudget } from "@/lib/budget";
import { MESSAGE_MAX } from "@/lib/chat-protocol";
import { SEAT_COLORS, normalizeSeatColor } from "@/lib/tokens";
import {
  type GroupChatResult,
  type GroupGround,
  type GroupMember,
  type GroupTurn,
  type Persona,
  type PersonaUpdate,
  type Room,
  type RoomMember,
  type RoomMessage,
  type RoomPreview,
  ROOM_MAX_MEMBERS,
  type RunGroupChat,
} from "@/lib/contracts";
import { CRISIS_TEXT, looksLikeCrisis } from "@/lib/crisis";
import { findGroupCommonGround } from "@/lib/qloo";
import { NAME_MAX } from "@/lib/sanitize";
import { PROFILE_ITEMS_MAX } from "@/lib/schemas";
import type { Profile } from "@/lib/types";
import { deviceHash } from "@/lib/meet/crypto";
import { type Identity, identityFromHash, isBlocked } from "@/lib/meet/blocks";
import { MEET_EARLY_MS, RED_FLAG_COOLDOWN_MS } from "@/lib/meet/config";
import { checkMessageSafety } from "@/lib/meet/pii";
import { type RedFlag, stepInText } from "@/lib/meet/red-flags";
import { hashToken, newMemberId, newRoomCode, newToken, tokenMatches } from "./codes";
import { type PublicMeetInfo, type RoomSignals, type StoredMeetInfo, type StoredRoom, getRoomStore } from "./store";
import type { RequestSignals } from "@/lib/types/signals";

// Rooms: up to 5 people, each on their own phone, chatting with each other and with Larry.
// Every change bumps `version`, so phones poll cheaply with ?since=version. Only one Larry run
// happens per room at a time (larryBusy). Presence (lastSeenAt) is saved without bumping the
// version, so polling alone never makes every phone download the room again.

/** Messages kept per room; older ones are dropped. */
export const ROOM_MESSAGES_MAX = 200;
/** First Steps kept per room. */
const ROOM_STEPS_MAX = 30;
/** Messages Larry reads. The agent trims further by length. */
const LARRY_HISTORY = 40;
/**
 * A Larry run that hasn't finished by now was killed (the messages route stops at 60 s); its lock
 * no longer counts, for asking or for what phones are shown.
 */
export const LARRY_LOCK_MS = 70_000;
/** Presence is written at most this often per member. */
const PRESENCE_EVERY_MS = 30_000;
/** A member not seen for this long gives up their seat when someone new needs it. */
export const GHOST_MS = 10 * 60 * 1000;


/** A failure to show to the person, with its HTTP status. */
export class RoomError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const NOT_FOUND = "That room isn't open. It may have ended. Ask for the code again.";
const FULL = `This room is full. Up to ${ROOM_MAX_MEMBERS} people can join.`;
const NOT_MEMBER = "You're not in this room any more. Join again with the code.";
const EMPTY = "Type a message first.";
const NOT_SET_UP = "Chat isn't set up yet. Try again later.";
const MEET_LARRY_STAYS = "In a meet chat, Larry stays to help keep it safe. You can leave, block or report at any time.";

export const notFound = () => new RoomError(404, NOT_FOUND);

export interface Joined {
  room: Room;
  memberId: string;
  token: string;
}

/* ---------------------------------------------------------------- helpers */

const newId = () => randomBytes(6).toString("base64url");

/** True while a Larry run holds the lock. A lock older than LARRY_LOCK_MS is from a killed run. */
function larryLocked(r: StoredRoom, now = Date.now()): boolean {
  return r.larryBusy && !!r.larryLock && now - r.larryLock.since <= LARRY_LOCK_MS;
}

/** A room as members' phones see it; meet rooms also say where they are and what the two share. */
export type PublicRoom = Room & { meet?: PublicMeetInfo };

/** What members' phones see: no token hashes, device hashes or other server-only fields. */
export function toPublic(r: StoredRoom): PublicRoom {
  return {
    code: r.code,
    createdAt: r.createdAt,
    // Rooms saved before the seat tokens hold category colours: show them as seats.
    members: r.members.map((m) => ({ ...m, color: normalizeSeatColor(m.color) })),
    messages: r.messages,
    steps: r.steps,
    version: r.version,
    larryBusy: larryLocked(r),
    ...(r.ground ? { ground: r.ground } : {}),
    // Distances are from the asker's exact location: never shown to the other members.
    ...(r.places?.length ? { places: r.places.map(withoutDistance) } : {}),
    ...(r.planTicket && !r.meet ? { planTicket: { ...r.planTicket, place: withoutDistance(r.planTicket.place) } } : {}),
    ...(r.larryAway ? { larryAway: true } : {}),
    ...(r.larryBackAt ? { larryBackAt: r.larryBackAt } : {}),
    ...(r.meet ? { meet: { venueName: r.meet.venueName, shared: r.meet.shared, ...leftOf(r) } } : {}),
  };
}

/** People who left a meet room, by id and name, for Block and Report. */
function leftOf(r: StoredRoom): { left?: { id: string; name: string }[] } {
  const here = new Set(r.members.map((m) => m.id));
  const left = Object.keys(r.departed ?? {})
    .filter((id) => !here.has(id))
    .map((id) => ({ id, name: r.names[id] ?? "Someone" }));
  return left.length ? { left } : {};
}

/** Members whose phones were seen lately; the others give up their seat to someone new. */
function liveMembers(r: Pick<StoredRoom, "members">, now: number): RoomMember[] {
  return r.members.filter((m) => now - m.lastSeenAt <= GHOST_MS);
}

/** What someone outside the room sees: who is in it and whether there is a seat. */
export function toPreview(r: StoredRoom, now = Date.now()): RoomPreview {
  return {
    code: r.code,
    names: r.members.map((m) => m.name),
    openSeats: Math.max(0, ROOM_MAX_MEMBERS - liveMembers(r, now).length),
  };
}

function bump(r: StoredRoom): StoredRoom {
  r.version += 1;
  return r;
}

function findMember(r: StoredRoom, memberId: unknown, token: unknown): RoomMember | undefined {
  if (typeof memberId !== "string") return undefined;
  const m = r.members.find((x) => x.id === memberId);
  return m && tokenMatches(token, r.tokenHashes[m.id]) ? m : undefined;
}

function requireMember(r: StoredRoom, memberId: unknown, token: unknown): RoomMember {
  const m = findMember(r, memberId, token);
  if (!m) throw new RoomError(403, NOT_MEMBER);
  return m;
}

/** "Sam", then "Sam 2" if a Sam is already here, so Larry can tell them apart. */
function uniqueName(name: string, taken: string[]): string {
  const lower = new Set(taken.map((n) => n.toLowerCase()));
  if (!lower.has(name.toLowerCase())) return name;
  for (let i = 2; ; i++) {
    const candidate = `${name.slice(0, NAME_MAX - 2).trim()} ${i}`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
}

/** The first free seat colour, in join order (SEAT_COLORS, the one list in @/lib/tokens). */
function seatColor(members: RoomMember[]): string {
  const used = new Set(members.map((m) => normalizeSeatColor(m.color)));
  return SEAT_COLORS.find((c) => !used.has(c)) ?? SEAT_COLORS[members.length % SEAT_COLORS.length];
}

function newMember(r: Pick<StoredRoom, "members">, profile: Profile, now: number): RoomMember {
  const name = uniqueName(profile.name, r.members.map((m) => m.name));
  return {
    id: newMemberId(),
    name,
    profile: { ...profile, name },
    color: seatColor(r.members),
    joinedAt: now,
    lastSeenAt: now,
  };
}

/**
 * One line of plain text from a person: no control characters or square brackets (so nobody can
 * fake a "[Name]" turn for Larry), and no links, emails, phone numbers or markdown, same as
 * Larry's own replies. At most MESSAGE_MAX characters.
 */
export function cleanMessage(raw: string): string {
  const plain = raw
    .slice(0, MESSAGE_MAX * 2)
    .normalize("NFC")
    .replace(/(?!‍)[\p{C}]/gu, " ")
    .replace(/[\[\]]/g, "")
    .replace(/\s+/g, " ");
  return cleanReply(plain).slice(0, MESSAGE_MAX).trim();
}

function appendMessages(r: StoredRoom, ...msgs: RoomMessage[]) {
  r.messages.push(...msgs);
  if (r.messages.length > ROOM_MESSAGES_MAX) r.messages = r.messages.slice(-ROOM_MESSAGES_MAX);
}

/** Keeps a member's own mood and Hidden Gems (never in a meet room, never age); empty input changes nothing. */
function setSignals(r: StoredRoom, memberId: string, s: RoomSignals | undefined) {
  if (r.meet || !s) return;
  const next: RoomSignals = { ...r.signals?.[memberId], ...s };
  if (!next.mood) delete next.mood;
  r.signals = { ...r.signals, [memberId]: next };
}

/** Drops a member's signals (when they leave or their seat is freed). */
function dropSignals(r: StoredRoom, memberId: string) {
  if (!r.signals?.[memberId]) return;
  const { [memberId]: _gone, ...rest } = r.signals;
  void _gone;
  r.signals = rest;
}

/**
 * The room's signals for Larry, from the members here now: their moods with no names attached
 * (moodBlend speaks in counts), and Hidden Gems when at least half the room has it on. Nothing for
 * a meet room: Open to meet never uses mood.
 */
export function roomSignals(r: Pick<StoredRoom, "members" | "signals" | "meet">): { moods: NonNullable<RoomSignals["mood"]>[]; signals?: RequestSignals } {
  if (r.meet) return { moods: [] };
  const here = r.members.map((m) => r.signals?.[m.id]).filter((s): s is RoomSignals => !!s);
  const moods = here.map((s) => s.mood).filter((m): m is NonNullable<RoomSignals["mood"]> => !!m);
  const gems = here.filter((s) => s.hiddenGems).length;
  return { moods, ...(r.members.length && gems * 2 >= r.members.length ? { signals: { hiddenGems: true } } : {}) };
}

function toGroupMember(m: RoomMember): GroupMember {
  return { id: m.id, name: m.name, profile: m.profile, color: normalizeSeatColor(m.color) };
}

/**
 * Whether Larry may read this message: never one sent while Larry was excused, and never one from
 * before Larry last came back (it starts fresh from its hello).
 */
export function larryMayRead(r: Pick<StoredRoom, "larryBackAt">, m: RoomMessage): boolean {
  return !m.excused && (r.larryBackAt === undefined || m.at >= r.larryBackAt);
}

/** Messages as chat turns for Larry: people as "[Name] text", Larry as plain text. */
export function historyFor(r: StoredRoom): GroupTurn[] {
  return r.messages
    .filter((m) => larryMayRead(r, m))
    .slice(-LARRY_HISTORY)
    .map((m) =>
    m.from === "larry"
      ? { role: "assistant", content: m.text }
      : { role: "user", content: `[${r.names[m.from] ?? "Someone who left"}] ${m.text}` },
  );
}

/** Which members and picks a ground was computed for. */
export function groundKey(members: RoomMember[]): string {
  return members
    .map((m) => `${m.id}:${m.profile.items.map((i) => i.id).sort().join(",")}`)
    .sort()
    .join("|");
}

/* ---------------------------------------------------------------- create, join, read, leave */

export async function createRoom(profile: Profile, deviceId?: string, signals?: RoomSignals): Promise<Joined> {
  const store = getRoomStore();
  const now = Date.now();
  for (let i = 0; i < 6; i++) {
    const member = newMember({ members: [] }, profile, now);
    const token = newToken();
    const room: StoredRoom = {
      code: newRoomCode(),
      createdAt: now,
      members: [member],
      messages: [],
      steps: [],
      version: 1,
      larryBusy: false,
      tokenHashes: { [member.id]: hashToken(token) },
      names: { [member.id]: member.name },
      ...(deviceId ? { devices: { [member.id]: deviceHash(deviceId) } } : {}),
      rev: 1,
      updatedAt: now,
    };
    setSignals(room, member.id, signals);
    if (await store.create(room)) return { room: toPublic(room), memberId: member.id, token };
  }
  // Six random codes in a row all taken: something is wrong with storage, not bad luck.
  throw new Error("Couldn't find a free room code");
}

export async function joinRoom(code: string, profile: Profile, deviceId?: string, signals?: RoomSignals): Promise<Joined> {
  const token = newToken();
  let member: RoomMember | undefined;
  const before = await getRoomStore().get(code);
  // Meet rooms are only for the two who waved. Someone blocked by (or blocking) a member can't
  // join either; both get the same answer as a room that doesn't exist, so a block can't be seen.
  if (!before || before.meet) throw notFound();
  const joiner = identityFromHash(deviceId ? deviceHash(deviceId) : undefined, profile.items);
  for (const m of before.members) {
    if (await isBlocked(joiner, memberIdentity(before, m))) throw notFound();
  }
  const room = await getRoomStore().update(code, (r) => {
    if (r.meet) return null;
    const now = Date.now();
    if (r.members.length >= ROOM_MAX_MEMBERS) {
      // Free the seats of phones that went away without leaving.
      const live = liveMembers(r, now);
      for (const m of r.members.filter((x) => !live.includes(x))) {
        rememberLeaver(r, m);
        delete r.tokenHashes[m.id];
        dropSignals(r, m.id);
      }
      r.members = live;
      if (r.members.length >= ROOM_MAX_MEMBERS) throw new RoomError(409, FULL);
    }
    member = newMember(r, profile, now);
    r.members.push(member);
    r.tokenHashes[member.id] = hashToken(token);
    r.names[member.id] = member.name;
    if (deviceId) r.devices = { ...r.devices, [member.id]: deviceHash(deviceId) };
    setSignals(r, member.id, signals);
    return bump(r);
  });
  if (!room || !member) throw notFound();
  return { room: toPublic(room), memberId: member.id, token };
}

/**
 * For a member (valid x-member-id and token): the room, or { unchanged: true } when `since` is its
 * current version, and the member is noted as seen (at most every 30 s, without a version bump).
 * Without credentials: only a preview (names and open seats), never the chat, cards or places.
 * Wrong credentials: 403, so a phone that was removed goes back to the join screen.
 * `onGroundStale` is called when the stored common ground doesn't fit the members and a new try
 * is due (after a Qloo failure, with backoff), so a failed lookup is never the last word.
 */
export async function readRoom(
  code: string,
  opts: { since?: number; memberId?: string | null; token?: string | null; onGroundStale?: () => void } = {},
): Promise<{ room: Room } | { unchanged: true } | { preview: RoomPreview }> {
  const store = getRoomStore();
  let r = await store.get(code);
  if (!r) throw notFound();
  const now = Date.now();
  // A meet room has no preview: nobody outside it learns who is in it.
  if (!opts.memberId && !opts.token) {
    if (r.meet) throw notFound();
    return { preview: toPreview(r, now) };
  }
  const me = findMember(r, opts.memberId, opts.token);
  if (!me) throw new RoomError(403, NOT_MEMBER);
  if (now - me.lastSeenAt >= PRESENCE_EVERY_MS) {
    r =
      (await store.update(code, (x) => {
        const m = x.members.find((y) => y.id === me.id);
        if (!m) return null;
        m.lastSeenAt = now;
        return x;
      })) ?? r;
  }
  if (opts.onGroundStale && r.members.length >= 2 && r.groundKey !== groundKey(r.members) && groundRetryDue(code, now)) {
    opts.onGroundStale();
  }
  if (opts.since !== undefined && opts.since === r.version) return { unchanged: true };
  return { room: toPublic(r) };
}

/** Removes the member. The last one out closes the room. */
export async function leaveRoom(code: string, memberId: unknown, token: unknown): Promise<{ ok: true; empty: boolean }> {
  const store = getRoomStore();
  let empty = false;
  const r = await store.update(code, (x) => {
    const leaver = requireMember(x, memberId, token);
    rememberLeaver(x, leaver);
    x.members = x.members.filter((m) => m.id !== memberId);
    delete x.tokenHashes[memberId as string];
    dropSignals(x, memberId as string);
    empty = x.members.length === 0;
    return bump(x);
  });
  if (!r) throw notFound();
  if (empty) await store.delete(code);
  return { ok: true, empty };
}

/* ---------------------------------------------------------------- Excuse and Hello Larry */

/**
 * "Excuse Larry" (away) and "Hello Larry" (back), for the whole room. While excused, messages are
 * kept for the people but never reach Larry, and no Larry run starts. Coming back, Larry starts
 * fresh: it reads only messages sent after that moment. Asking for the state the room is already
 * in changes nothing (no version bump).
 */
export async function setLarryAway(code: string, memberId: unknown, token: unknown, away: boolean): Promise<{ room: Room }> {
  const store = getRoomStore();
  const current = await store.get(code);
  if (!current) throw notFound();
  requireMember(current, memberId, token);
  if (current.meet && away) throw new RoomError(400, MEET_LARRY_STAYS);
  const r = await store.update(code, (x) => {
    requireMember(x, memberId, token);
    if (!!x.larryAway === away) return null;
    if (away) x.larryAway = true;
    else {
      delete x.larryAway;
      x.larryBackAt = Date.now();
    }
    return bump(x);
  });
  if (!r) throw notFound();
  return { room: toPublic(r) };
}

/* ---------------------------------------------------------------- messages and Larry */

export interface PostInput {
  memberId: string;
  token: string;
  text: string;
  toLarry: boolean;
  /** Typed while this phone showed Larry as excused: kept from Larry even if someone said hello meanwhile. */
  excused?: boolean;
  location?: { lat: number; lon: number };
  /** The asker's persona (from their phone), so Larry can use it and say what it learned. */
  persona?: Persona;
  /** The asker's own mood and Hidden Gems (never age). Kept server-side for the blend, never shown. */
  signals?: RoomSignals;
  /** Place ids the asker's phone was shown lately. */
  recentPlaces?: string[];
}

export interface PostResult {
  room: Room;
  /** The words may mean a crisis: the phone shows the helplines card. */
  crisis?: true;
  /** What Larry learned about the asker this turn (only the asker's phone gets it). */
  personaUpdate?: PersonaUpdate;
}

/** How an authorized Larry run is charged: its own model calls (wrap the hold) and nested ones (charge). */
export interface RunCharge {
  wrap: (hold: BudgetHold) => BudgetHold;
  charge?: (usd: number) => void | Promise<void>;
}

export interface PostOptions {
  /** Throws when over a rate limit. "crisis" is checked instead of the others for a crisis line. */
  limit?: (kind: "message" | "larry" | "crisis") => void;
  /** Called when Larry changed someone's picks, so the ground should be computed again. */
  onPicksChanged?: () => void;
  /** Replaces the agent (the e2e test hook). */
  runGroupChat?: RunGroupChat;
  /**
   * Called only when Larry (AI) is about to run: checks the asker may use AI (their access code)
   * and returns how to wrap the budget hold so the run is charged to it. Throws to refuse.
   */
  authorize?: () => Promise<RunCharge>;
}

/**
 * Adds a person's message. A possible crisis gets the fixed help reply from Larry straight away
 * (no model call, no rate limit can turn it away). Otherwise, when the message is for Larry and
 * Larry isn't already replying, runs Larry and adds the reply. Larry's lock is always released.
 *
 * While Larry is excused (or the phone says the line was typed while it was), the message is kept
 * for the people only: marked excused, never for Larry, no Larry run. A crisis line then gets no
 * Larry reply either; the answer says `crisis`, so the phone shows the helplines card.
 */
export async function postMessage(code: string, input: PostInput, opts: PostOptions = {}): Promise<PostResult> {
  const store = getRoomStore();
  const current = await store.get(code);
  if (!current) throw notFound();
  const me = requireMember(current, input.memberId, input.token);
  const text = cleanMessage(input.text);
  if (!text) throw new RoomError(400, EMPTY);
  const crisis = looksLikeCrisis(input.text.slice(0, MESSAGE_MAX * 2)) || looksLikeCrisis(text);

  // Meet rooms: Larry can't be excused (it watches for red flags), and a red flag gets Larry's
  // fixed step-in line at once, whoever the message was for.
  const meet = current.meet;
  // Regex first, then Amazon Comprehend (server only, falls back to the regex on its own).
  const flag =
    meet && !crisis
      ? ((await checkMessageSafety(input.text, { early: Date.now() - current.createdAt < MEET_EARLY_MS, venue: meet.venueName })).redFlag ?? null)
      : null;

  if (!meet && (current.larryAway || input.excused)) return addExcused(code, me, text, input, opts, crisis);

  // Crisis check first, on what they typed and on the cleaned text.
  if (crisis) {
    try {
      opts.limit?.("crisis");
    } catch {
      // A flood of crisis lines: the help reply is already in the room, so just show it.
      return { room: toPublic(current), crisis: true };
    }
    const r = await store.update(code, (x) => {
      requireMember(x, me.id, input.token);
      const at = Date.now();
      if (x.larryAway) {
        // Excused just now: the line stays with the people, and Larry doesn't answer.
        appendMessages(x, { id: newId(), from: me.id, text, at, toLarry: false, excused: true });
        return bump(x);
      }
      appendMessages(
        x,
        { id: newId(), from: me.id, text, at, toLarry: input.toLarry },
        { id: newId(), from: "larry", text: CRISIS_TEXT, at, toLarry: false },
      );
      return bump(x);
    });
    if (!r) throw notFound();
    return { room: toPublic(r), crisis: true };
  }

  opts.limit?.("message");
  if (input.toLarry) {
    opts.limit?.("larry");
    if (!opts.runGroupChat && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) throw new RoomError(503, NOT_SET_UP);
  }

  // Held before posting (like /api/chat), so a used-up budget doesn't leave a question nobody answers.
  const auth = input.toLarry && opts.authorize ? await opts.authorize() : undefined;
  const held = input.toLarry ? await holdBudget() : undefined;
  const budget = held && auth ? auth.wrap(held) : held;
  try {
    return await addAndAnswer(code, me, text, input, opts, budget, flag, auth?.charge);
  } finally {
    budget?.release();
  }
}

/** A message while Larry is excused: stored for the people, marked excused, no Larry run, no model call. */
async function addExcused(
  code: string,
  me: RoomMember,
  text: string,
  input: PostInput,
  opts: PostOptions,
  crisis: boolean,
): Promise<PostResult> {
  try {
    opts.limit?.(crisis ? "crisis" : "message");
  } catch (err) {
    // A flood of crisis lines: the helplines card still shows on the phone.
    if (crisis) {
      const r = await getRoomStore().get(code);
      if (!r) throw notFound();
      return { room: toPublic(r), crisis: true };
    }
    throw err;
  }
  const r = await getRoomStore().update(code, (x) => {
    requireMember(x, me.id, input.token);
    appendMessages(x, { id: newId(), from: me.id, text, at: Date.now(), toLarry: false, excused: true });
    return bump(x);
  });
  if (!r) throw notFound();
  return { room: toPublic(r), ...(crisis ? { crisis: true as const } : {}) };
}

async function addAndAnswer(
  code: string,
  me: RoomMember,
  text: string,
  input: PostInput,
  opts: PostOptions,
  budget: BudgetHold | undefined,
  flag: RedFlag | null = null,
  charge?: (usd: number) => void | Promise<void>,
): Promise<{ room: Room; personaUpdate?: PersonaUpdate }> {
  const store = getRoomStore();
  // Add the message and, if it's for Larry, take the lock in the same write.
  const lockId = newId();
  let locked = false;
  let startedAt = 0;
  const posted = await store.update(code, (x) => {
    requireMember(x, me.id, input.token);
    const now = Date.now();
    locked = false;
    startedAt = now;
    // Excused between the first read and this write: kept from Larry, and Larry doesn't run.
    if (x.larryAway && !x.meet) {
      appendMessages(x, { id: newId(), from: me.id, text, at: now, toLarry: false, excused: true });
      return bump(x);
    }
    appendMessages(x, { id: newId(), from: me.id, text, at: now, toLarry: input.toLarry });
    setSignals(x, me.id, input.signals);
    // A red flag in a meet chat: Larry steps in with its fixed line (no model call) and that is
    // its whole answer this time.
    const steppedIn = !!flag && !!x.meet && stepIn(x.meet, flag, now);
    if (steppedIn) appendMessages(x, { id: newId(), from: "larry", text: stepInText(flag!, x.meet!.venueName), at: now, toLarry: false });
    const lockFree = !larryLocked(x, now);
    if (input.toLarry && lockFree && !steppedIn) {
      x.larryBusy = true;
      x.larryLock = { id: lockId, since: now };
      locked = true;
    }
    return bump(x);
  });
  if (!posted) throw notFound();
  // Not for Larry, or Larry is already replying (and will see this message next time).
  if (!locked) return { room: toPublic(posted) };

  const release = (x: StoredRoom) => {
    if (x.larryLock?.id !== lockId) return false;
    x.larryBusy = false;
    delete x.larryLock;
    return true;
  };

  try {
    const blend = roomSignals(posted);
    const chatInput: GroupChatInputPlus = {
      mode: "group",
      members: posted.members.map(toGroupMember),
      history: historyFor(posted),
      // A meet chat never looks for other places: any meeting is at the venue they are at.
      ...(input.location && !posted.meet ? { location: input.location } : {}),
      ...(posted.ground ? { ground: posted.ground } : {}),
      // The asker's persona: Larry uses it, and only the asker's phone gets what it learned. Never
      // in a meet chat: notes and routines ("plays cricket on Sundays") must not reach a stranger.
      ...(input.persona && !posted.meet ? { personas: { [me.id]: input.persona } } : {}),
      // Open to meet: Larry stays on what they share and only ever suggests this public venue.
      ...(posted.meet ? { meet: { venueName: posted.meet.venueName } } : {}),
      // Moods in counts only and the room's Hidden Gems; never in a meet chat, never anyone's age.
      ...(!posted.meet && blend.moods.length ? { roomMoods: blend.moods } : {}),
      ...(!posted.meet && blend.signals ? { signals: blend.signals } : {}),
      ...(!posted.meet && input.recentPlaces?.length ? { recentPlaces: input.recentPlaces } : {}),
    };
    const result: GroupChatResult = await (opts.runGroupChat ?? runGroupChat)(chatInput, undefined, {
      budget,
      ...(charge ? { charge } : {}),
    });
    let picksChanged = false;
    const done = await store.update(code, (x) => {
      const ours = release(x);
      // Excused while Larry was thinking (or excused and back again, so Larry started fresh): the
      // reply is dropped. Larry doesn't talk, plan or change picks while it is out.
      if (x.larryAway || (x.larryBackAt ?? 0) > startedAt) return ours ? bump(x) : null;
      const at = Date.now();
      const replies = result.quiet ? [] : result.messages.map((m) => cleanReply(m.text).slice(0, 2000)).filter(Boolean);
      appendMessages(x, ...replies.map((t) => ({ id: newId(), from: "larry", text: t, at, toLarry: false })));
      const steps = x.meet ? meetSafeSteps(result.steps, x.meet) : result.steps;
      if (steps.length) x.steps = [...x.steps, ...steps].slice(-ROOM_STEPS_MAX);
      // Never store a distance: it is measured from the asker's exact location (group runs drop it
      // already; this keeps it off disk and away from the other members whatever the runner sent).
      const places = x.meet ? [] : (result.places ?? []).slice(0, 6).map(withoutDistance);
      if (places.length) x.places = places;
      // A meet chat's only plan is the venue they are at, which they already know.
      const ticket = x.meet ? undefined : result.planTicket;
      if (ticket) x.planTicket = { ...ticket, place: withoutDistance(ticket.place) };
      picksChanged = false;
      for (const { memberId, item } of result.profileUpdates) {
        const m = x.members.find((y) => y.id === memberId);
        if (!m || m.profile.items.some((i) => i.id === item.id) || m.profile.items.length >= PROFILE_ITEMS_MAX) continue;
        m.profile.items.push(item);
        picksChanged = true;
      }
      if (result.ground && groundKey(x.members) === groundKey(posted.members) && !picksChanged) {
        x.ground = result.ground;
        x.groundKey = groundKey(x.members);
      }
      return ours || replies.length || steps.length || places.length || ticket || picksChanged ? bump(x) : null;
    });
    if (!done) throw notFound();
    if (picksChanged) opts.onPicksChanged?.();
    const learned = input.persona && !posted.meet ? result.personaUpdates?.[me.id] : undefined;
    return { room: toPublic(done), ...(learned ? { personaUpdate: learned } : {}) };
  } catch (err) {
    // Always free Larry, even when the run failed, so the room isn't stuck.
    await store.update(code, (x) => (release(x) ? bump(x) : null)).catch((e) => console.error("Couldn't release Larry's lock", e));
    throw err;
  }
}

/* ---------------------------------------------------------------- Open to meet rooms */

/** Whether Larry may step in for this red flag now (once per kind per cooldown); notes the time. */
function stepIn(meet: StoredMeetInfo, flag: RedFlag, now: number): boolean {
  meet.flagsAt ??= {};
  if (now - (meet.flagsAt[flag] ?? 0) < RED_FLAG_COOLDOWN_MS) return false;
  meet.flagsAt[flag] = now;
  return true;
}

/** In a meet chat, a "go" step must be the venue they are at; say and show steps are fine. */
export function meetSafeSteps<T extends { kind: string; text: string }>(steps: T[], meet: Pick<StoredMeetInfo, "venueName">): T[] {
  const venue = meet.venueName.toLowerCase();
  return steps.filter((s) => s.kind !== "go" || s.text.toLowerCase().includes(venue));
}

export interface MeetSeat {
  profile: Profile;
  /** HMAC of the device id, from the meet visit. */
  device: string;
}

export interface MeetRoomCreated {
  room: PublicRoom;
  seats: [{ memberId: string; token: string }, { memberId: string; token: string }];
}

/**
 * The room a mutual wave opens: the two people and Larry, closed to anyone else. Larry opens it
 * with what they share and where to meet (the same public venue), with no model call.
 */
export async function createMeetRoom(a: MeetSeat, b: MeetSeat, meet: { venueName: string; shared: string[] }): Promise<MeetRoomCreated> {
  const store = getRoomStore();
  const now = Date.now();
  for (let i = 0; i < 6; i++) {
    const ma = newMember({ members: [] }, a.profile, now);
    const mb = newMember({ members: [ma] }, b.profile, now);
    const ta = newToken();
    const tb = newToken();
    const room: StoredRoom = {
      code: newRoomCode(),
      createdAt: now,
      members: [ma, mb],
      messages: [{ id: newId(), from: "larry", text: meetIntro(meet), at: now, toLarry: false }],
      steps: [],
      version: 1,
      larryBusy: false,
      tokenHashes: { [ma.id]: hashToken(ta), [mb.id]: hashToken(tb) },
      names: { [ma.id]: ma.name, [mb.id]: mb.name },
      devices: { [ma.id]: a.device, [mb.id]: b.device },
      meet: { venueName: meet.venueName, shared: meet.shared, flagsAt: {} },
      rev: 1,
      updatedAt: now,
    };
    if (await store.create(room)) {
      return { room: toPublic(room), seats: [{ memberId: ma.id, token: ta }, { memberId: mb.id, token: tb }] };
    }
  }
  throw new Error("Couldn't find a free room code");
}

/** Larry's first line in a meet chat: who it is, what they share, and the public-venue rule. */
export function meetIntro(meet: { venueName: string; shared: string[] }): string {
  const shared = meet.shared.length
    ? `You both like ${meet.shared.length === 1 ? meet.shared[0] : `${meet.shared.slice(0, -1).join(", ")} and ${meet.shared.at(-1)}`}.`
    : "I found something you'd both love.";
  return [
    "Hi, I'm Larry, an AI pal. You both waved, so here you are.",
    shared,
    "That could be a good first thing to talk about.",
    `If you want to meet, meet here at ${meet.venueName}, out in the open.`,
    "Anyone can leave, block or report at any time.",
  ].join(" ");
}

/** Who a member is, for blocks: their phone (if known) and their picks. */
export function memberIdentity(r: Pick<StoredRoom, "devices">, m: Pick<RoomMember, "id" | "profile">): Identity {
  return identityFromHash(r.devices?.[m.id], m.profile.items);
}

/** Keeps who someone was as they leave (hashes only), so they can still be blocked or reported. */
function rememberLeaver(x: StoredRoom, m: RoomMember) {
  x.departed ??= {};
  x.departed[m.id] = memberIdentity(x, m);
}

export interface SafetyContext {
  meet: boolean;
  me: Identity;
  them: Identity;
  /** The last messages, as who said what (for a report). */
  messages: { from: "reported" | "reporter" | "larry" | "other"; text: string }[];
}

/**
 * For Block and Report from inside a room: checks the asker is a member, and returns both
 * people's identities and the recent messages. The target may have left already: who they were
 * is kept (as hashes) when anyone leaves, so Block and Report always work.
 */
export async function roomSafetyContext(code: string, memberId: unknown, token: unknown, targetId: string, deviceId?: string): Promise<SafetyContext> {
  const r = await getRoomStore().get(code);
  if (!r) throw notFound();
  const me = requireMember(r, memberId, token);
  const target = r.members.find((m) => m.id === targetId);
  const them = target ? memberIdentity(r, target) : r.departed?.[targetId];
  if (!them || targetId === me.id) throw new RoomError(404, "We couldn't find that person in this room.");
  const meIdentity = memberIdentity(r, me);
  return {
    meet: !!r.meet,
    me: deviceId && !meIdentity.device ? { ...meIdentity, device: deviceHash(deviceId) } : meIdentity,
    them,
    messages: r.messages.slice(-20).map((m) => ({
      from: m.from === "larry" ? "larry" : m.from === targetId ? "reported" : m.from === me.id ? "reporter" : "other",
      text: m.text,
    })),
  };
}

/**
 * Takes a blocked person out of a room, so the two are never in one room again. In a meet room,
 * Larry says the chat has ended (to whoever is still there).
 */
export async function removeBlocked(code: string, targetId: string): Promise<void> {
  const store = getRoomStore();
  const r = await store.update(code, (x) => {
    const target = x.members.find((m) => m.id === targetId);
    if (!target) return null;
    rememberLeaver(x, target);
    x.members = x.members.filter((m) => m.id !== targetId);
    delete x.tokenHashes[targetId];
    if (x.meet) appendMessages(x, { id: newId(), from: "larry", text: "This chat has ended.", at: Date.now(), toLarry: false });
    return bump(x);
  });
  if (r && r.members.length === 0) await store.delete(code);
}

/* ---------------------------------------------------------------- group common ground */

// Per server instance: one ground computation per room at a time. A change during a run marks
// the room dirty, and the run goes again, so a burst of joins makes at most two Qloo rounds.
// Failed lookups (Qloo busy, say) are tried again from readRoom, with backoff per room.
interface GroundState {
  running: Set<string>;
  dirty: Set<string>;
  /** room code -> when its last lookup started, and how many failed in a row. */
  attempts: Map<string, { at: number; fails: number }>;
}
const g = globalThis as typeof globalThis & { __larryGround?: GroundState };
const groundState = (g.__larryGround ??= { running: new Set(), dirty: new Set(), attempts: new Map() });
groundState.attempts ??= new Map();

/** First retry after a failure, doubling up to GROUND_RETRY_MAX_MS. */
export const GROUND_RETRY_MS = 5_000;
const GROUND_RETRY_MAX_MS = 60_000;

/** Whether a new ground lookup for this room may start now (none running, backoff over). */
export function groundRetryDue(code: string, now = Date.now()): boolean {
  if (groundState.running.has(code)) return false;
  const a = groundState.attempts.get(code);
  if (!a) return true;
  const wait = a.fails ? Math.min(GROUND_RETRY_MAX_MS, GROUND_RETRY_MS * 2 ** (a.fails - 1)) : GROUND_RETRY_MS;
  return now - a.at >= wait;
}

/**
 * Computes the room's common ground for its current members and picks, and stores it. Does
 * nothing if it is already up to date. Clears it when fewer than two people are left. Never throws.
 */
export async function refreshGround(
  code: string,
  // Qloo's ranking only by default: Larry's curation is a model call, so it runs only when the
  // caller passes a find that charges it to someone's access code.
  find: (members: GroupMember[], signals?: RequestSignals) => Promise<GroupGround> = (m, signals) =>
    findGroupCommonGround(m, undefined, { curate: false, ...(signals ? { signals } : {}) }),
): Promise<void> {
  const { running, dirty } = groundState;
  if (running.has(code)) {
    dirty.add(code);
    return;
  }
  running.add(code);
  const store = getRoomStore();
  try {
    for (let round = 0; round < 3; round++) {
      dirty.delete(code);
      let again = false;
      const r = await store.get(code);
      if (!r) return;
      const key = groundKey(r.members);
      if (r.members.length < 2) {
        if (r.ground || r.groundKey) {
          await store.update(code, (x) => {
            if (x.members.length >= 2) return null;
            delete x.ground;
            delete x.groundKey;
            return bump(x);
          });
        }
      } else if (r.groundKey !== key) {
        let ground: GroupGround;
        const attempts = groundState.attempts;
        const prev = attempts.get(code);
        if (attempts.size > 5_000) attempts.clear();
        attempts.set(code, { at: Date.now(), fails: prev?.fails ?? 0 });
        try {
          ground = await find(r.members.map(toGroupMember), roomSignals(r).signals);
        } catch (err) {
          // Tried again from readRoom once the backoff is over.
          attempts.set(code, { at: Date.now(), fails: (prev?.fails ?? 0) + 1 });
          console.error("Group common ground failed:", err instanceof Error ? err.message : err);
          return;
        }
        attempts.set(code, { at: Date.now(), fails: 0 });
        // Only if the members didn't change while Qloo was working; otherwise go again.
        await store.update(code, (x) => {
          again = groundKey(x.members) !== key;
          if (again) return null;
          x.ground = ground;
          x.groundKey = key;
          return bump(x);
        });
      }
      if (!again && !dirty.has(code)) return;
    }
  } catch (err) {
    console.error("Group common ground failed:", err instanceof Error ? err.message : err);
  } finally {
    running.delete(code);
    dirty.delete(code);
  }
}
