import "server-only";
import { verifyVisitToken } from "@/lib/checkin-verify";
import { createMeetRoom, removeBlocked, roomSafetyContext } from "@/lib/rooms/service";
import type { WittyOpts } from "@/lib/types/witty";
import { wittyLineWithin } from "@/lib/witty";
import { type RoomCredentials } from "@/lib/contracts";
import type { TasteItem } from "@/lib/types";
import { addBlock, blockChecker, type Identity, identityFromHash } from "./blocks";
import {
  MEET_IDLE_MS,
  MEET_LIKES_MAX,
  MEET_NEARBY_MAX,
  MEET_SEEN_EVERY_MS,
  MEET_TTL_MS,
  MEET_VENUES_PER_CODE_DAY,
  PICKS_LOCK_MS,
  type ReportReason,
  WAVES_PER_VISIT,
} from "./config";
import { deviceHash, groupIdFor, newSessionToken, newSid, pairKey, sessionMatches, sha256 } from "./crypto";
import { getMeetKv } from "./kv";
import { presenceAt, type Where } from "./presence";
import { addReport, type ReportMessage } from "./reports";
import { type FindGround, type Topic, cachedBridges, groupLine, queueBridges, sharedPicks, topicFor, topicKey } from "./shared";
import { type FetchPlace, getVenue, type Venue } from "./venue";

// Open to meet (PRODUCT.md). Short-lived, per venue, in memory or Upstash with TTLs:
//  - A venue's document holds only the people open there right now, and once-per-visit wave
//    records (hashed device pairs) for up to 3 hours. No location, history or schedule is kept.
//  - Proof of presence: switching on, the list and waving all need the phone's location within
//    MEET_NEAR_M of the venue's own Qloo coordinates. It is checked and thrown away; leaving the
//    venue switches Open to meet off. A copied QR card is no use from somewhere else.
//  - Before a mutual wave, others see only an anonymous count per shared thing ("2 people here
//    like Ghibli"). Each person is counted under one thing only, and only with a Qloo bridge or
//    2+ picks in common, so nobody's card can be read off the list.
//  - Picks are fixed for the visit (and for PICKS_LOCK_MS after it on that phone at that venue),
//    so nobody can re-open with new picks to fish for what a stranger likes.
//  - Only for signed-in accounts (accounts are 18+) with a verified check-in at this venue (the
//    visit token from /api/checkins/arrive). Blocks follow the account, not the phone.
//  - One account can switch on at only MEET_VENUES_PER_CODE_DAY venues a day.
//  - Each shared thing gets Larry's witty line (witty.ts), grounded in that thing only.
//  - A wave (at a group) is one per person per visit; a mutual wave opens a room with Larry.
//  - Block hides both people from each other everywhere, for good. Report also blocks.

export class MeetError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const ADULT_ONLY = "Open to meet is for 18+. Quick check, and you're in.";
export const NEEDS_ACCOUNT = "Open to meet is for signed-in members aged 18+. Sign in, and you're in.";
export const NEEDS_CHECKIN = "Check in here first, then Open to meet can switch on.";
const NO_PICKS = "Pick a few things you like first, so Larry can find what you share with people here.";
const SWITCHED_OFF = "Open to meet is off now. Switch it on again if you are still here.";
const GONE = "That person isn't here any more.";
const WRONG_PLACE = "This is for a different place. Check in here first.";
const TOO_MANY_WAVES = "You've waved a lot this visit. Take a break and see who waves back.";
const NO_FIX = "Open to meet needs your location to check you are here. Allow location for this page, then try again.";
const FUZZY = "Your phone can't tell exactly where you are. Step near a window or the door, then try again.";
const AWAY = (venue: string) => `You don't seem to be at ${venue} right now. Open to meet only works while you are there.`;
const LEFT = (venue: string) => `You seem to have left ${venue}, so Open to meet is off now.`;
const PICKS_FIXED = "Your picks are fixed for this visit. Switch off, and you can switch on with new picks in 30 minutes.";
const TOO_MANY_VENUES = "You've switched on at a lot of places today. Try again tomorrow.";

interface Match {
  /** The other person's visit. */
  with: string;
  roomCode: string;
  memberId: string;
  token: string;
  /** Their member id in the room, so a block can take them out of it. */
  theirMemberId: string;
}

interface MeetSession {
  sid: string;
  tokenHash: string;
  /** HMAC of the device id. */
  device: string;
  /** Only used to name them in the room a mutual wave opens. Never sent to anyone before that. */
  name: string;
  likes: TasteItem[];
  expiresAt: number;
  seenAt: number;
  /** Visits this person waved at. */
  waves: string[];
  matches: Match[];
}

interface VenueDoc {
  placeId: string;
  venueName: string;
  sessions: Record<string, MeetSession>;
  /** pairKey(from device, to device, place) -> when the record lapses. One wave per person per visit. */
  waved: Record<string, number>;
  /** Pairs a room is being opened for, so two waves at once open one room. */
  opening: Record<string, number>;
  /** device hash -> the picks fingerprint that visit used, kept PICKS_LOCK_MS after it ends. */
  locks?: Record<string, { fp: string; until: number }>;
}

/** Where a session token points; stored under the token's hash. */
interface SessionRef {
  placeId: string;
  sid: string;
}

const venueKey = (placeId: string) => `venue-open:${placeId.toLowerCase()}`;
const sessionKey = (tokenHash: string) => `session:${tokenHash}`;
const deviceKey = (device: string) => `device-open:${device}`;

const live = (s: MeetSession, now: number) => s.expiresAt > now && now - s.seenAt <= MEET_IDLE_MS;

/** Picks stay fixed on that phone at that venue for a while after a visit ends (`endedAt`). */
function lockPicks(doc: VenueDoc, s: MeetSession, endedAt: number) {
  doc.locks ??= {};
  doc.locks[s.device] = { fp: identity(s).fp, until: endedAt + PICKS_LOCK_MS };
}

/** Drops people whose time ran out or whose phone went away, and lapsed wave records. */
function prune(doc: VenueDoc, now: number): VenueDoc {
  for (const [sid, s] of Object.entries(doc.sessions))
    if (!live(s, now)) {
      // It ended when its time ran out or its phone went quiet, not when this prune noticed.
      lockPicks(doc, s, Math.min(s.expiresAt, s.seenAt + MEET_IDLE_MS));
      delete doc.sessions[sid];
    }
  for (const [k, until] of Object.entries(doc.waved)) if (until <= now) delete doc.waved[k];
  for (const [k, since] of Object.entries(doc.opening ?? {})) if (now - since > 60_000) delete doc.opening[k];
  for (const [k, lock] of Object.entries(doc.locks ?? {})) if (lock.until <= now) delete doc.locks![k];
  doc.opening ??= {};
  doc.locks ??= {};
  return doc;
}

const isEmpty = (doc: VenueDoc) =>
  !Object.keys(doc.sessions).length && !Object.keys(doc.waved).length && !Object.keys(doc.locks ?? {}).length;

/* ---------------------------------------------------------------- proof of presence */

/** Throws unless the phone's fix shows it at the venue. The fix is never stored or logged. */
function assertHere(venue: Venue, where: Where | null | undefined): void {
  if (!where) throw new MeetError(428, NO_FIX);
  const r = presenceAt(venue, where);
  if (r === "fuzzy") throw new MeetError(403, FUZZY);
  if (r === "away") throw new MeetError(403, AWAY(venue.name));
}

/**
 * The check for a visit already on: a phone that is clearly somewhere else is switched off at
 * once (410). A missing or fuzzy fix only refuses this answer; the visit stays on for now.
 */
async function assertStillHere(r: Resolved, where: Where | null | undefined, deps: Deps): Promise<void> {
  const venue = await getVenue(r.ref.placeId, deps.fetchPlace);
  try {
    assertHere(venue, where);
  } catch (err) {
    if (err instanceof MeetError && where && presenceAt(venue, where) === "away") {
      await closeByRef(r.ref, r.me.tokenHash);
      throw new MeetError(410, LEFT(venue.name));
    }
    throw err;
  }
}

/** One access code can switch on at only a few different venues a day. */
async function takeVenueSlot(code: string, placeId: string): Promise<void> {
  const mark = pairKey("code-venue", code, placeId.toLowerCase());
  let full = false;
  await getMeetKv().update<string[]>(
    `code-venues:${pairKey("code-venues", code)}`,
    (cur) => {
      const list = cur ?? [];
      if (list.includes(mark)) return null;
      if (list.length >= MEET_VENUES_PER_CODE_DAY) {
        full = true;
        return null;
      }
      return [...list, mark];
    },
    24 * 60 * 60 * 1000,
  );
  if (full) throw new MeetError(429, TOO_MANY_VENUES);
}

function identity(s: Pick<MeetSession, "device" | "likes">): Identity {
  return identityFromHash(s.device, s.likes);
}

/* ---------------------------------------------------------------- open and close */

export interface OpenInput {
  deviceId: string;
  /** The signed-in account (accounts are 18+). Blocks follow it across phones. */
  uid?: string;
  /** From /api/checkins/arrive at this venue: proof of a verified check-in here. */
  visitToken?: string;
  persona: { name: string; likes: TasteItem[] };
  adult: boolean;
  /** Where the phone is now: checked against the venue, then thrown away. */
  where: Where | null;
  /** The access code (for the venues-per-day cap). */
  code?: string;
}

export interface Deps {
  fetchPlace?: FetchPlace;
  findGround?: FindGround;
  /** Charges Larry's witty lines to the viewer's Larry time. */
  budget?: WittyOpts["budget"];
  /** How long a poll waits for a fresh witty line before the fallback answers (the model's line is cached for the next poll). */
  wittyWaitMs?: number;
}

/**
 * Switches Open to meet on at a venue for 3 hours, only for a phone that is there. Opening again
 * at the same place starts the 3 hours again (same visit, new token) but must use the same picks.
 * Opening at another place closes the old one first: you can only be in one place.
 */
export async function openMeet(placeId: string, input: OpenInput, deps: Deps = {}): Promise<{ sessionId: string; expiresAt: number }> {
  if (input.adult !== true) throw new MeetError(400, ADULT_ONLY);
  const likes = dedupe(input.persona.likes).slice(0, MEET_LIKES_MAX);
  if (!likes.length) throw new MeetError(400, NO_PICKS);
  const venue = await getVenue(placeId, deps.fetchPlace);
  if (input.visitToken !== undefined) {
    const visit = verifyVisitToken(input.visitToken);
    if (!visit || visit.placeId.toLowerCase() !== venue.id.toLowerCase()) throw new MeetError(403, NEEDS_CHECKIN);
  }
  assertHere(venue, input.where);
  if (input.code) await takeVenueSlot(input.code, venue.id);
  const kv = getMeetKv();
  // An account is known by its uid (HMACed), so a block holds on every phone it signs in on.
  const device = deviceHash(input.uid ? `acct:${input.uid}` : input.deviceId);
  const fp = identityFromHash(device, likes).fp;

  const prev = await kv.get<SessionRef & { tokenHash: string }>(deviceKey(device));
  if (prev && prev.placeId.toLowerCase() !== venue.id.toLowerCase()) await closeByRef(prev, prev.tokenHash);

  const token = newSessionToken();
  const tokenHash = sha256(token);
  const now = Date.now();
  const expiresAt = now + MEET_TTL_MS;
  let sid = "";
  let oldTokenHash: string | undefined;
  await kv.update<VenueDoc>(
    venueKey(venue.id),
    (cur) => {
      const doc = prune(cur ?? { placeId: venue.id, venueName: venue.name, sessions: {}, waved: {}, opening: {} }, now);
      doc.venueName = venue.name;
      const mine = Object.values(doc.sessions).find((s) => s.device === device);
      // Same picks for the whole visit, and for a while after it: otherwise re-opening with new
      // picks under the same anonymous ids would read off a stranger's card bit by bit.
      const lock = doc.locks?.[device];
      if (mine ? identity(mine).fp !== fp : lock && lock.until > now && lock.fp !== fp) throw new MeetError(409, PICKS_FIXED);
      oldTokenHash = mine?.tokenHash;
      sid = mine?.sid ?? newSid();
      doc.sessions[sid] = {
        sid,
        tokenHash,
        device,
        name: input.persona.name,
        likes,
        expiresAt,
        seenAt: now,
        waves: mine?.waves ?? [],
        matches: mine?.matches ?? [],
      };
      return doc;
    },
    MEET_TTL_MS,
  );
  if (oldTokenHash && oldTokenHash !== tokenHash) await kv.del(sessionKey(oldTokenHash));
  await kv.update<SessionRef>(sessionKey(tokenHash), () => ({ placeId: venue.id, sid }), MEET_TTL_MS);
  await kv.update(deviceKey(device), () => ({ placeId: venue.id, sid, tokenHash }), MEET_TTL_MS);
  return { sessionId: token, expiresAt };
}

function dedupe(items: TasteItem[]): TasteItem[] {
  const seen = new Set<string>();
  return items.filter((i) => i.name && !seen.has(i.id) && seen.add(i.id));
}

async function closeByRef(ref: SessionRef, tokenHash: string): Promise<void> {
  const kv = getMeetKv();
  let device: string | undefined;
  await kv.update<VenueDoc>(
    venueKey(ref.placeId),
    (cur) => {
      if (!cur) return null;
      const doc = prune(cur, Date.now());
      const s = doc.sessions[ref.sid];
      if (s && s.tokenHash === tokenHash) {
        device = s.device;
        lockPicks(doc, s, Date.now());
        delete doc.sessions[ref.sid];
      }
      return isEmpty(doc) ? undefined : doc;
    },
    MEET_TTL_MS,
  );
  await kv.del(sessionKey(tokenHash));
  if (device) {
    const d = device;
    await kv.update<SessionRef & { tokenHash: string }>(deviceKey(d), (cur) => (cur?.tokenHash === tokenHash ? undefined : null));
  }
}

/** Switches Open to meet off now. Always works, and says ok even when it was already off. */
export async function closeMeet(sessionId: string): Promise<{ ok: true }> {
  if (typeof sessionId !== "string" || !sessionId) return { ok: true };
  const tokenHash = sha256(sessionId);
  const ref = await getMeetKv().get<SessionRef>(sessionKey(tokenHash));
  if (ref) await closeByRef(ref, tokenHash);
  return { ok: true };
}

/* ---------------------------------------------------------------- who is here */

interface Resolved {
  doc: VenueDoc;
  me: MeetSession;
  ref: SessionRef;
}

async function resolve(sessionId: unknown, placeId?: string): Promise<Resolved> {
  if (typeof sessionId !== "string" || !sessionId || sessionId.length > 200) throw new MeetError(401, SWITCHED_OFF);
  const kv = getMeetKv();
  const tokenHash = sha256(sessionId);
  const ref = await kv.get<SessionRef>(sessionKey(tokenHash));
  if (!ref) throw new MeetError(410, SWITCHED_OFF);
  if (placeId && ref.placeId.toLowerCase() !== placeId.toLowerCase()) throw new MeetError(403, WRONG_PLACE);
  const doc = await kv.get<VenueDoc>(venueKey(ref.placeId));
  const me = doc?.sessions[ref.sid];
  const now = Date.now();
  if (!doc || !me || !sessionMatches(sessionId, me.tokenHash) || !live(me, now)) {
    await closeByRef(ref, tokenHash);
    throw new MeetError(410, SWITCHED_OFF);
  }
  return { doc: prune(doc, now), me, ref };
}

export interface NearbyGroup {
  /** Different for every viewer, venue, visit and thing. Wave at it to wave at its people. */
  groupId: string;
  /** "pick": a pick you both made. "bridge": something Qloo says both your tastes point to. */
  kind: Topic["kind"];
  /** The one shared thing, e.g. "Spirited Away". */
  thing: string;
  /** How many people here are counted under it (each person under one thing only). */
  count: number;
  /** The easy-read line: "2 people here like Spirited Away too." (a count only when 2+). */
  line: string;
  /** Larry's witty line about the shared thing, and the same in plain words (R6). Never about a person. */
  witty: { line: string; plain: string };
  /** You already waved at everyone in it this visit. */
  waved: boolean;
}

export interface NearbyResult {
  venue: { name: string };
  expiresAt: number;
  /** Anonymous counts per shared thing: never one entry per person, never a list of their picks. */
  groups: NearbyGroup[];
  /** Chats this visit's mutual waves opened, with this phone's credentials for each. */
  matches: { roomCode: string; credentials: RoomCredentials }[];
}

/** New Qloo pair lookups started per poll. */
const NEW_PAIRS_PER_POLL = 3;

interface Seen {
  s: MeetSession;
  shared: string[];
  bridges: string[];
  topic: Topic;
}

/** Everyone open at the venue who is not blocked either way and has real common ground with the viewer. */
async function visibleOthers(r: Resolved, deps: Deps, queueNew = 0): Promise<Seen[]> {
  const blocked = await blockChecker(identity(r.me));
  const mine = { fp: identity(r.me).fp, likes: r.me.likes };
  const out: Seen[] = [];
  let queued = 0;
  for (const s of Object.values(r.doc.sessions)) {
    if (s.sid === r.me.sid || (await blocked(identity(s)))) continue;
    const theirs = { fp: identity(s).fp, likes: s.likes };
    const shared = sharedPicks(r.me.likes, s.likes);
    let bridges = await cachedBridges(mine, theirs);
    if (bridges === undefined && queued < queueNew) {
      queued++;
      // In the background; this poll answers with what is known now.
      void queueBridges(mine, theirs, deps.findGround);
      bridges = undefined;
    }
    const topic = topicFor({ both: shared, bridges: bridges ?? [] });
    if (topic) out.push({ s, shared, bridges: bridges ?? [], topic });
  }
  return out;
}

/** The people behind each shared thing, keyed by the viewer's group id. */
function groupsOf(r: Resolved, others: Seen[]): Map<string, { topic: Topic; people: Seen[] }> {
  const groups = new Map<string, { topic: Topic; people: Seen[] }>();
  for (const o of others) {
    const id = groupIdFor(r.me.sid, r.ref.placeId.toLowerCase(), topicKey(o.topic));
    const g = groups.get(id) ?? { topic: o.topic, people: [] };
    g.people.push(o);
    groups.set(id, g);
  }
  return groups;
}

/** The nearby list for this visit, for a phone that is still at the venue. Also notes it is still here. */
export async function listNearby(placeId: string, sessionId: unknown, where: Where | null, deps: Deps = {}): Promise<NearbyResult> {
  const r = await resolve(sessionId, placeId);
  await assertStillHere(r, where, deps);
  const now = Date.now();
  if (now - r.me.seenAt >= MEET_SEEN_EVERY_MS) {
    await getMeetKv().update<VenueDoc>(
      venueKey(r.ref.placeId),
      (cur) => {
        const s = cur?.sessions[r.me.sid];
        if (!cur || !s || s.tokenHash !== r.me.tokenHash) return null;
        s.seenAt = now;
        return cur;
      },
      MEET_TTL_MS,
    );
  }
  const others = await visibleOthers(r, deps, NEW_PAIRS_PER_POLL);
  const listed = [...groupsOf(r, others)]
    // Sorted by group id: a fixed, meaningless order, so nothing says who arrived first or last.
    .sort((x, y) => (x[0] < y[0] ? -1 : 1))
    .slice(0, MEET_NEARBY_MAX);
  const groups: NearbyGroup[] = await Promise.all(
    listed.map(async ([groupId, g]) => ({
      groupId,
      kind: g.topic.kind,
      thing: g.topic.thing,
      count: g.people.length,
      line: groupLine(g.topic, g.people.length),
      witty: await meetWitty(g.topic, deps),
      waved: g.people.every((p) => r.me.waves.includes(p.s.sid)),
    })),
  );
  return {
    venue: { name: r.doc.venueName },
    expiresAt: r.me.expiresAt,
    groups,
    matches: r.me.matches.map((m) => ({ roomCode: m.roomCode, credentials: { code: m.roomCode, memberId: m.memberId, token: m.token } })),
  };
}

/**
 * Larry's line for one shared thing: written from that thing only (never from a person, the venue
 * or a count), validated, cached across viewers, and answered within a short wait so a poll is
 * never held up. Mood is never used here: it is never shown to strangers.
 */
async function meetWitty(t: Topic, deps: Deps): Promise<{ line: string; plain: string }> {
  const r = await wittyLineWithin("meet", [{ name: t.thing, kind: t.kind }], deps.budget ? { budget: deps.budget } : undefined, deps.wittyWaitMs ?? 2500);
  return { line: r.line, plain: r.plain };
}

/** The venue's checked name, for the page before switching on. Nothing about who is there. */
export async function venueInfo(placeId: string, deps: Deps = {}): Promise<{ venue: { name: string } }> {
  const v = await getVenue(placeId, deps.fetchPlace);
  return { venue: { name: v.name } };
}

/* ---------------------------------------------------------------- wave */

async function findGroup(r: Resolved, groupId: unknown, deps: Deps): Promise<Seen[]> {
  if (typeof groupId !== "string") throw new MeetError(404, GONE);
  const g = groupsOf(r, await visibleOthers(r, deps)).get(groupId);
  if (!g?.people.length) throw new MeetError(404, GONE);
  return g.people;
}

export type WaveResult = { mutual: false; already?: true } | { mutual: true; roomCode: string; credentials: RoomCredentials };

/**
 * A wave at a group in the nearby list ("2 people here like Ghibli"): a wave at each person in
 * it, one per person per visit (a second is a no-op), at most WAVES_PER_VISIT people in all.
 * Nobody is told about a one-sided wave. When one of them waved at you too, a room opens with
 * the two of you and Larry.
 */
export async function wave(placeId: string, sessionId: unknown, groupId: unknown, where: Where | null, deps: Deps = {}): Promise<WaveResult> {
  const r = await resolve(sessionId, placeId);
  await assertStillHere(r, where, deps);
  const people = await findGroup(r, groupId, deps);
  let opened: WaveResult | undefined;
  let existing: WaveResult | undefined;
  let waved = false;
  for (const target of people) {
    const match = r.me.matches.find((m) => m.with === target.s.sid);
    if (match) {
      existing ??= { mutual: true, roomCode: match.roomCode, credentials: { code: match.roomCode, memberId: match.memberId, token: match.token } };
      continue;
    }
    let res: WaveResult;
    try {
      res = await waveOne(r, target);
    } catch (err) {
      // Someone in the group just left: wave at the rest.
      if (err instanceof MeetError && err.status === 404 && people.length > 1) continue;
      // Out of waves part-way through a group: the ones already sent still count.
      if (err instanceof MeetError && err.status === 429 && (waved || opened)) break;
      throw err;
    }
    if (res.mutual) opened ??= res;
    else if (!res.already) waved = true;
  }
  if (opened) return opened;
  if (!waved && existing) return existing;
  return waved ? { mutual: false } : { mutual: false, already: true };
}

/** One wave at one person (the core of a group wave). */
async function waveOne(r: Resolved, target: Seen): Promise<WaveResult> {
  const kv = getMeetKv();
  const now = Date.now();
  const mineKey = pairKey("wave", r.me.device, target.s.device, r.ref.placeId.toLowerCase());
  const theirsKey = pairKey("wave", target.s.device, r.me.device, r.ref.placeId.toLowerCase());
  const openKey = pairKey("pair", ...[r.me.sid, target.s.sid].sort());
  // Set inside the update (which may run more than once); read after it.
  const state: { outcome: "already" | "waved" | "mutual" | "busy" } = { outcome: "waved" };
  await kv.update<VenueDoc>(
    venueKey(r.ref.placeId),
    (cur) => {
      if (!cur) return null;
      const doc = prune(cur, now);
      const me = doc.sessions[r.me.sid];
      const them = doc.sessions[target.s.sid];
      if (!me || !them) throw new MeetError(404, GONE);
      if (doc.waved[mineKey]) {
        state.outcome = doc.waved[theirsKey] && !doc.opening[openKey] && !me.matches.some((m) => m.with === them.sid) ? "mutual" : "already";
      } else {
        if (me.waves.length >= WAVES_PER_VISIT) throw new MeetError(429, TOO_MANY_WAVES);
        doc.waved[mineKey] = now + MEET_TTL_MS;
        me.waves.push(them.sid);
        state.outcome = doc.waved[theirsKey] ? "mutual" : "waved";
      }
      if (state.outcome === "mutual") {
        if (doc.opening[openKey]) state.outcome = "busy";
        else doc.opening[openKey] = now;
      }
      return state.outcome === "already" || state.outcome === "busy" ? null : doc;
    },
    MEET_TTL_MS,
  );
  if (state.outcome === "already" || state.outcome === "busy") return { mutual: false, ...(state.outcome === "already" ? { already: true as const } : {}) };
  if (state.outcome === "waved") return { mutual: false };

  // Both waved: open the room. The one who waved first takes the first seat.
  try {
    const shared = [...target.shared, ...target.bridges].slice(0, 3);
    const created = await createMeetRoom(
      { profile: { name: target.s.name, items: target.s.likes.slice(0, 20) }, device: target.s.device },
      { profile: { name: r.me.name, items: r.me.likes.slice(0, 20) }, device: r.me.device },
      { venueName: r.doc.venueName, shared },
    );
    const [theirSeat, mySeat] = created.seats;
    const code = created.room.code;
    await kv.update<VenueDoc>(
      venueKey(r.ref.placeId),
      (cur) => {
        if (!cur) return null;
        delete cur.opening?.[openKey];
        const me = cur.sessions[r.me.sid];
        const them = cur.sessions[target.s.sid];
        me?.matches.push({ with: target.s.sid, roomCode: code, memberId: mySeat.memberId, token: mySeat.token, theirMemberId: theirSeat.memberId });
        them?.matches.push({ with: r.me.sid, roomCode: code, memberId: theirSeat.memberId, token: theirSeat.token, theirMemberId: mySeat.memberId });
        return cur;
      },
      MEET_TTL_MS,
    );
    return { mutual: true, roomCode: code, credentials: { code, memberId: mySeat.memberId, token: mySeat.token } };
  } catch (err) {
    await kv.update<VenueDoc>(venueKey(r.ref.placeId), (cur) => (cur?.opening?.[openKey] ? (delete cur.opening[openKey], cur) : null), MEET_TTL_MS);
    throw err;
  }
}

/* ---------------------------------------------------------------- block and report */

/** Who is asking and about whom: from the nearby list (a meet visit) or from inside a room. */
export type SafetyTarget =
  | { sessionId: string; groupId: string }
  | { room: RoomCredentials; targetMemberId: string; deviceId?: string };

interface SafetyResolved {
  me: Identity;
  /** Everyone the block covers: one person from a chat, or everyone in a group of the list. */
  them: Identity[];
  where: "nearby" | "meet-chat" | "room";
  messages: ReportMessage[];
  /** Rooms to take the blocked person out of: room code -> their member id. */
  rooms: { code: string; memberId: string }[];
}

async function resolveSafety(t: SafetyTarget, deps: Deps): Promise<SafetyResolved> {
  if ("sessionId" in t) {
    // No presence check: Block and Report must always work.
    const r = await resolve(t.sessionId);
    const people = await findGroup(r, t.groupId, deps);
    const sids = new Set(people.map((p) => p.s.sid));
    const rooms = r.me.matches.filter((m) => sids.has(m.with)).map((m) => ({ code: m.roomCode, memberId: m.theirMemberId }));
    return { me: identity(r.me), them: people.map((p) => identity(p.s)), where: "nearby", messages: [], rooms };
  }
  const ctx = await roomSafetyContext(t.room.code, t.room.memberId, t.room.token, t.targetMemberId, t.deviceId);
  return {
    me: ctx.me,
    them: [ctx.them],
    where: ctx.meet ? "meet-chat" : "room",
    messages: ctx.messages,
    rooms: [{ code: t.room.code, memberId: t.targetMemberId }],
  };
}

/** Blocks someone: both are hidden from each other everywhere, for good, and leave shared rooms. */
export async function block(t: SafetyTarget, deps: Deps = {}): Promise<{ ok: true }> {
  const s = await resolveSafety(t, deps);
  for (const them of s.them) await addBlock(s.me, them);
  for (const room of s.rooms) await removeBlocked(room.code, room.memberId).catch((e) => console.error("Couldn't remove a blocked member", e));
  return { ok: true };
}

/** Reports someone for review (with the last messages, from a chat) and blocks them too. */
export async function report(t: SafetyTarget, reason: ReportReason, note: string | undefined, deps: Deps = {}): Promise<{ ok: true }> {
  const s = await resolveSafety(t, deps);
  for (const them of s.them) {
    await addReport({ reason, ...(note ? { note } : {}), where: s.where, reporter: s.me, reported: them, messages: s.messages });
    await addBlock(s.me, them);
  }
  for (const room of s.rooms) await removeBlocked(room.code, room.memberId).catch((e) => console.error("Couldn't remove a reported member", e));
  return { ok: true };
}
