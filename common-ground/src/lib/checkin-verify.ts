import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { getSession as realGetSession, isDemoAccount } from "./account/session";
import { enrichPlace, type Enrichment, type EnrichInput } from "./aws/location";
import type { ArriveRefusal } from "./checkins";
import { getRepo } from "./db";
import type { RepoKv } from "./db/types";
import { readJsonBody } from "./http";
import { MEET_ACCURACY_MAX_M, MEET_NEAR_M, MEET_SLACK_M } from "./meet/config";
import { metresBetween } from "./meet/presence";
import { fetchQlooPlace, PLACE_ID_RE, VenueError, type FetchPlace } from "./meet/venue";
import { hoursText, parseHours, closedAllDays, type WeekHours } from "./qloo";
import { clientIp, take } from "./rate-limit";
import { arriveSchema, leaveSchema } from "./schemas";
import type { GetSession, Session } from "./types/account";
import { CHECKIN_RULES, type ArriveResponse, type LeaveReason, type LeaveResponse, type VerifiedVisit } from "./types/checkin";
import { GLORY_RULES } from "./types/glory";
import { MOODS } from "./types/signals";
import { STAGES } from "./types/titles";
import type { SharedItem, WittyOpts, WittyResult } from "./types/witty";
import { titleWord } from "./titles";
import { wittyLine } from "./witty";
import { z } from "zod";

// Check-in v2 on the server (D19, D20, D23). Arrive and Leave each bring one fresh location fix. It
// is checked against the Qloo place's own coordinates (cross-checked with Amazon Location's pin) and
// thrown away. Nothing about the visit is stored: the arrive time and fix travel inside a sealed
// visit token the phone hands back on Leave. The only thing written is an HMAC day key with a 26 h
// TTL (one visit per place per day) and, for an account, its Glory total. No request field is logged.
//
// The one demo/testing account (isDemoAccount: the verified token's phone number equals env
// DEMO_PHONE, decided in src/lib/account/session.ts) skips the location, closed-now and dwell checks.
// Its visits count like real ones. It is exempt from nothing else.

/* ---------------------------------------------------------------- secrets and the visit token */

const g = globalThis as typeof globalThis & { __larryCheckinSecret?: string };

function secret(): string {
  const env = process.env.CHECKIN_SECRET || process.env.MEET_SECRET;
  if (env && env.length >= 32) return env;
  // One dev server or a test: a per-process secret is fine (a restart only drops open visits).
  return (g.__larryCheckinSecret ??= randomBytes(32).toString("base64url"));
}

const keyFor = (purpose: string) => createHash("sha256").update(`larry-checkin\u0000${purpose}\u0000${secret()}`).digest();
const hmac = (purpose: string, ...parts: string[]) => createHmac("sha256", keyFor(purpose)).update(parts.join("\u0000")).digest("base64url");

/** What a visit token carries. Sealed (AES-256-GCM): the phone can't read or change it. */
interface VisitClaims {
  /** placeId */
  p: string;
  /** Arrive time, ms */
  t: number;
  /** Arrive fix, rounded to about 11 m, for the speed check. Absent for the demo account. */
  la?: number;
  lo?: number;
  /** Dwell needed, ms (0 only for the demo account). */
  d: number;
  /** Who arrived: an HMAC of the account uid, or "-" for a device-only person. */
  u: string;
  /**
   * Device-only visits: the one-per-day identity, fixed at Arrive. An HMAC of the phone's device id,
   * or a random per-visit nonce when none was sent. Never the IP: people sharing Wi-Fi or a carrier
   * NAT must not block each other, and a network change mid-visit must not move the key.
   */
  w?: string;
}

/** A token older than this can't be used to leave (the phone settles it as "Visited"). */
export const VISIT_TOKEN_MAX_MS = 12 * 60 * 60 * 1000;

const b64 = (b: Buffer) => b.toString("base64url");

export function sealVisit(c: VisitClaims): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor("token"), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(c), "utf8"), cipher.final()]);
  return `${b64(iv)}.${b64(body)}.${b64(cipher.getAuthTag())}`;
}

function openVisit(token: string, now = Date.now()): VisitClaims | null {
  if (typeof token !== "string" || token.length > 600) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const [iv, body, tag] = parts.map((p) => Buffer.from(p, "base64url"));
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = createDecipheriv("aes-256-gcm", keyFor("token"), iv);
    decipher.setAuthTag(tag);
    const c = JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8")) as VisitClaims;
    if (typeof c.p !== "string" || !PLACE_ID_RE.test(c.p) || !Number.isFinite(c.t) || !Number.isFinite(c.d) || typeof c.u !== "string") return null;
    if (c.t > now + 60_000 || now - c.t > VISIT_TOKEN_MAX_MS) return null;
    return c;
  } catch {
    return null;
  }
}

/** Exported for 2F (Open to meet gate): the place and arrive time a valid visit token proves. */
export function verifyVisitToken(token: string, now = Date.now()): VerifiedVisit | null {
  const c = openVisit(token, now);
  return c ? { placeId: c.p, t: c.t } : null;
}

const whoKey = (session: Session | null) => (session ? hmac("who", session.uid).slice(0, 22) : "-");

/** A device-only person's one-per-day identity: their phone's id, HMACed, or a random nonce. Never the IP. */
const deviceWho = (deviceId: string | undefined) => (deviceId ? `dev:${hmac("device", deviceId).slice(0, 22)}` : `once:${randomBytes(12).toString("base64url")}`);

/* ---------------------------------------------------------------- the place */

/** The place as the check-in needs it: Qloo's name, pin and hours. Cached for a day (public data). */
export interface CheckinPlace {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Qloo's opening hours, when it has them. */
  hours?: WeekHours;
  /** Qloo says the business has closed down. */
  closedDown?: boolean;
}

const PLACE_TTL_MS = 24 * 60 * 60 * 1000;

export async function getCheckinPlace(placeId: string, kv: RepoKv, fetchPlace: FetchPlace = fetchQlooPlace): Promise<CheckinPlace | null> {
  if (!PLACE_ID_RE.test(placeId)) return null;
  const cacheKey = `checkin-place:${placeId.toLowerCase()}`;
  const hit = await kv.get<CheckinPlace | { none: true }>(cacheKey);
  if (hit) return "none" in hit ? null : hit;
  const p = await fetchPlace(placeId);
  const lat = Number(p?.location?.lat);
  const lon = Number(p?.location?.lon);
  const located = Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0);
  if (!p || !(p.types ?? ["urn:entity:place"]).includes("urn:entity:place") || !located) {
    await kv.update(cacheKey, () => ({ none: true as const }), PLACE_TTL_MS);
    return null;
  }
  const props = (p.properties ?? {}) as { is_closed?: boolean; hours?: unknown };
  const hours = parseHours(props.hours);
  const place: CheckinPlace = {
    id: p.entity_id,
    name: String(p.name ?? "").replace(/[\p{C}\[\]<>]/gu, "").slice(0, 80).trim() || "this place",
    lat,
    lon,
    // A week with every day closed is Qloo not knowing, not a place that never opens.
    ...(hours && !closedAllDays(hours) ? { hours } : {}),
    ...(props.is_closed ? { closedDown: true } : {}),
  };
  await kv.update(cacheKey, () => place, PLACE_TTL_MS);
  return place;
}

/* ---------------------------------------------------------------- pure checks */

export interface Fix {
  lat: number;
  lon: number;
  accuracyM: number;
}

type LatLon = { lat: number; lon: number };

/**
 * D23 (1): the points a fix may be measured from. Qloo's pin always; Amazon's pin too when the D22
 * name+distance match found it and the two pins are under 150 m apart (a slightly wrong Qloo pin
 * shouldn't turn away someone who is really there). Pins further apart use Qloo's only.
 */
export function venueCentres(qloo: LatLon, amazon?: LatLon | null): LatLon[] {
  if (!amazon || !Number.isFinite(amazon.lat) || !Number.isFinite(amazon.lon)) return [qloo];
  return metresBetween(qloo, amazon) < CHECKIN_RULES.radiusM ? [qloo, amazon] : [qloo];
}

/** D20: "here" within 150 m of the nearest centre (+ up to 100 m slack for a fuzzy fix); "fuzzy" worse than 300 m. */
export function fixAt(centres: LatLon[], fix: Fix): "here" | "away" | "fuzzy" {
  if (![fix.lat, fix.lon, fix.accuracyM].every(Number.isFinite) || fix.accuracyM < 0 || fix.accuracyM > MEET_ACCURACY_MAX_M) return "fuzzy";
  const d = Math.min(...centres.map((c) => metresBetween(c, fix)));
  return d <= MEET_NEAR_M + Math.min(fix.accuracyM, MEET_SLACK_M) ? "here" : "away";
}

/**
 * The venue's local weekday (Monday 0) and minute of the day. Qloo hours are local time. India is
 * one zone (the hackathon city); elsewhere the longitude gives a close-enough offset.
 */
export function localClock(now: Date, at: LatLon): { day: number; minute: number } {
  const inIndia = at.lat > 6 && at.lat < 37 && at.lon > 68 && at.lon < 98;
  const offsetMin = inIndia ? 330 : Math.round(at.lon / 15) * 60;
  const local = new Date(now.getTime() + offsetMin * 60_000);
  return { day: (local.getUTCDay() + 6) % 7, minute: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

/** Open at this local time by these hours (spans past midnight count for the next morning). */
export function openAt(week: WeekHours, clock: { day: number; minute: number }): boolean {
  const today = week[clock.day] ?? [];
  const yesterday = week[(clock.day + 6) % 7] ?? [];
  return today.some((s) => s.open <= clock.minute && clock.minute < s.close) || yesterday.some((s) => s.close > 1440 && clock.minute < s.close - 1440);
}

/**
 * D23 (2): closed right now, by Qloo's hours or Amazon's open-now flag. Unknown hours never block,
 * and neither does a missing Amazon answer.
 */
export function closedNow(place: Pick<CheckinPlace, "hours" | "closedDown" | "lat" | "lon">, amazon: Pick<Enrichment, "openNow"> | null, now: Date): boolean {
  if (place.closedDown) return true;
  if (place.hours) return !openAt(place.hours, localClock(now, place));
  return amazon?.openNow === false;
}

/** Why an Arrive can't start a visit, or null when it can. The demo account skips all three. */
export function checkArrive(o: { fix: Fix; centres: LatLon[]; closed: boolean; demo: boolean }): Exclude<ArriveRefusal, "already-today" | "no-place"> | null {
  if (o.demo) return null;
  const at = fixAt(o.centres, o.fix);
  if (at === "fuzzy") return "fuzzy";
  if (at === "away") return "too-far";
  if (o.closed) return "closed";
  return null;
}

/**
 * Why a Leave doesn't count, or null when it does (one per day is checked after, in the route).
 * The demo account skips the location, speed and dwell checks.
 */
export function checkLeave(o: { claims: Pick<VisitClaims, "t" | "d" | "la" | "lo">; fix: Fix; centres: LatLon[]; now: number; demo: boolean }): LeaveReason | null {
  if (o.demo) return null;
  const at = fixAt(o.centres, o.fix);
  if (at === "fuzzy") return "no-coords";
  if (at === "away") return "too-far";
  const elapsed = o.now - o.claims.t;
  if (Number.isFinite(o.claims.la) && Number.isFinite(o.claims.lo) && elapsed > 0) {
    const kmh = metresBetween({ lat: o.claims.la!, lon: o.claims.lo! }, o.fix) / 1000 / (elapsed / 3_600_000);
    if (kmh > CHECKIN_RULES.maxSpeedKmh) return "too-fast";
  }
  // A demo token (d = 0) without the demo session still needs the full 20 minutes.
  if (elapsed < CHECKIN_RULES.minDwellMs) return "too-soon";
  return null;
}

/** The venue's local calendar day, "2026-10-31", for the one-per-day key. */
export function localDay(now: Date, at: LatLon): string {
  const inIndia = at.lat > 6 && at.lat < 37 && at.lon > 68 && at.lon < 98;
  const offsetMin = inIndia ? 330 : Math.round(at.lon / 15) * 60;
  return new Date(now.getTime() + offsetMin * 60_000).toISOString().slice(0, 10);
}

/** The one-per-day key: an HMAC, so the store can't tell who or where. */
export const dayKey = (who: string, placeId: string, day: string) => `checkin-day:${hmac("day", who, placeId.toLowerCase(), day).slice(0, 32)}`;

/* ---------------------------------------------------------------- handlers */

export interface CheckinDeps {
  getSession?: GetSession;
  fetchPlace?: FetchPlace;
  enrich?: (place: EnrichInput, now: Date) => Promise<Enrichment>;
  kv?: RepoKv;
  /** Adds Glory to an account. Returns the amount added (0 when there is no account). */
  addAccountGlory?: (uid: string, amount: number) => Promise<number>;
  now?: () => number;
}

const ARRIVE_LIMIT = { burst: 6, refillPerSec: 1 / 20, daily: 60 };
const LEAVE_LIMIT = { burst: 6, refillPerSec: 1 / 20, daily: 60 };

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** A refusal with its reason and the warm line (the client may also word it from the reason). */
function refuse(reason: ArriveRefusal, place: string, status: number): Response {
  const lines: Record<ArriveRefusal, string> = {
    "too-far": `Looks like you're not at ${place} yet. Check in when you get there!`,
    closed: `Looks like ${place} is closed right now. Check in when it's open!`,
    fuzzy: "Your phone isn't sure where you are yet. Step outside or near a window, then try again.",
    "already-today": `Already counted at ${place} today. Come back another day for the next one.`,
    "no-place": "We couldn't find this place right now. Try again in a moment?",
  };
  return json({ error: lines[reason], reason }, status);
}

const defaultGlory = async (uid: string, amount: number) => {
  if (!(amount > 0)) return 0;
  const after = await getRepo().accounts.update(uid, (a) => ({ ...a, glory: Math.max(0, a.glory) + amount }));
  return after ? amount : 0;
};

/**
 * Dev-only e2e hooks (never in a production build): x-e2e-fake-qloo makes any well-formed place id
 * the fake café at the e2e venue location with unknown hours; x-e2e-now-offset-ms moves this
 * request's clock forward, so a test can leave "20 minutes later" without waiting.
 */
function e2eHooks(request: Request, deps: CheckinDeps): CheckinDeps {
  if (process.env.NODE_ENV !== "development") return deps;
  const out = { ...deps };
  if (request.headers.get("x-e2e-fake-qloo") === "1") {
    out.fetchPlace = async (id) => ({ entity_id: id, name: "E2E Board Game Cafe", types: ["urn:entity:place"], location: { lat: 51.5072, lon: -0.1276 } });
    out.enrich = async () => ({});
    out.kv = { get: async () => null, update: async (_k, change) => change(null) ?? null, del: async () => {} };
  }
  const shift = Number(request.headers.get("x-e2e-now-offset-ms"));
  if (Number.isFinite(shift) && shift > 0 && shift < VISIT_TOKEN_MAX_MS) {
    const base = deps.now ?? Date.now;
    out.now = () => base() + shift;
  }
  return out;
}

async function placeAndCentres(placeId: string, d: Required<Pick<CheckinDeps, "fetchPlace" | "enrich" | "kv">>, now: Date) {
  const place = await getCheckinPlace(placeId, d.kv, d.fetchPlace);
  if (!place) return null;
  const amazon = await d.enrich({ name: place.name, lat: place.lat, lon: place.lon, ...(place.hours ? { hours: hoursText(place.hours) } : {}) }, now).catch(() => ({}) as Enrichment);
  return { place, amazon, centres: venueCentres(place, amazon.pin) };
}

function parseFix(b: { lat: number; lon: number; accuracyM: number }): Fix {
  return { lat: b.lat, lon: b.lon, accuracyM: b.accuracyM };
}

/** POST /api/checkins/arrive */
export async function handleArrive(request: Request, base: CheckinDeps = {}): Promise<Response> {
  const deps = e2eHooks(request, base);
  if (!take(`checkin-arrive:${clientIp(request)}`, ARRIVE_LIMIT)) return json({ error: "Lots of check-ins at once. Wait a minute, then try again." }, 429);
  const parsed = arriveSchema.safeParse(await readJsonBody(request, 4_000).catch(() => null));
  if (!parsed.success) return json({ error: "Hmm, that didn't go through. Try again in a moment?" }, 400);
  const body = parsed.data;
  const now = (deps.now ?? Date.now)();
  const session = await (deps.getSession ?? realGetSession)(request).catch(() => null);
  const demo = isDemoAccount(session);
  const kv = deps.kv ?? getRepo().kv;
  let found: Awaited<ReturnType<typeof placeAndCentres>>;
  try {
    found = await placeAndCentres(body.placeId, { fetchPlace: deps.fetchPlace ?? fetchQlooPlace, enrich: deps.enrich ?? enrichPlace, kv }, new Date(now));
  } catch (err) {
    if (err instanceof VenueError && err.status === 429) return json({ error: err.message }, 503);
    return refuse("no-place", "this place", 503);
  }
  if (!found) return refuse("no-place", "this place", 404);
  const { place, amazon, centres } = found;
  const fix = parseFix(body);
  const refusal = checkArrive({ fix, centres, closed: closedNow(place, amazon, new Date(now)), demo });
  if (refusal) return refuse(refusal, place.name, 422);
  const who = whoKey(session) === "-" ? deviceWho(body.deviceId) : whoKey(session);
  if (await kv.get(dayKey(who, place.id, localDay(new Date(now), place)))) return refuse("already-today", place.name, 409);
  const dwellMs = demo ? 0 : CHECKIN_RULES.minDwellMs;
  const claims: VisitClaims = {
    p: place.id,
    t: now,
    d: dwellMs,
    u: whoKey(session),
    ...(who !== whoKey(session) ? { w: who } : {}),
    ...(demo ? {} : { la: Math.round(fix.lat * 1e4) / 1e4, lo: Math.round(fix.lon * 1e4) / 1e4 }),
  };
  const out: ArriveResponse & { placeName: string } = { visitToken: sealVisit(claims), dwellMs, placeName: place.name };
  return json(out);
}

/** POST /api/checkins/leave */
export async function handleLeave(request: Request, base: CheckinDeps = {}): Promise<Response> {
  const deps = e2eHooks(request, base);
  if (!take(`checkin-leave:${clientIp(request)}`, LEAVE_LIMIT)) return json({ error: "Lots of check-ins at once. Wait a minute, then try again." }, 429);
  const parsed = leaveSchema.safeParse(await readJsonBody(request, 4_000).catch(() => null));
  if (!parsed.success) return json({ error: "Hmm, that didn't go through. Try again in a moment?" }, 400);
  const body = parsed.data;
  const now = (deps.now ?? Date.now)();
  const claims = openVisit(body.visitToken, now);
  if (!claims) return json({ error: "This visit has ended. Tap I'm here to start a new one.", reason: "expired" }, 410);
  const session = await (deps.getSession ?? realGetSession)(request).catch(() => null);
  // The token is tied to whoever arrived: an account's token can't be finished signed out, or by another account.
  if (claims.u !== whoKey(session)) return json({ error: "This visit has ended. Tap I'm here to start a new one.", reason: "expired" }, 410);
  const demo = isDemoAccount(session) && claims.d === 0;
  const kv = deps.kv ?? getRepo().kv;

  let centres: LatLon[] = [];
  let place: CheckinPlace | null = null;
  try {
    const found = await placeAndCentres(claims.p, { fetchPlace: deps.fetchPlace ?? fetchQlooPlace, enrich: deps.enrich ?? enrichPlace, kv }, new Date(now));
    if (found) ({ place, centres } = found);
  } catch {
    // Qloo down: the leave can't be checked right now, so the visit stays open for another try.
  }
  if (!place) {
    const res: LeaveResponse = { verified: false, reason: "no-coords", gloryDelta: 0 };
    return json(res);
  }
  const reason = checkLeave({ claims, fix: parseFix(body), centres, now, demo });
  if (reason) {
    const res: LeaveResponse = { verified: false, reason, gloryDelta: 0 };
    return json(res);
  }
  // One per place per day: the key is written only now, for a verified visit.
  // A device-only token without w (sealed before this rule) gets a fresh nonce: it still counts once.
  const who = claims.u === "-" ? (claims.w ?? deviceWho(undefined)) : claims.u;
  let first = false;
  await kv.update<{ v: 1 }>(
    dayKey(who, place.id, localDay(new Date(now), place)),
    (cur) => {
      first = cur === null;
      return cur ? null : { v: 1 };
    },
    CHECKIN_RULES.dayKeyTtlMs,
  );
  if (!first) {
    const res: LeaveResponse = { verified: false, reason: "already-today", gloryDelta: 0 };
    return json(res);
  }
  const amount = GLORY_RULES.visit + (body.saidHi ? GLORY_RULES["said-hi"] : 0);
  let gloryDelta = 0;
  if (session) {
    gloryDelta = await (deps.addAccountGlory ?? defaultGlory)(session.uid, amount).catch(() => 0);
    // Stage 2 (2B): the podium increment goes here, only with body.podiumKey, an 18+ session and
    // Account.showOnLeaderboards on (D12). The key is never logged or stored next to the uid.
  }
  const res: LeaveResponse = { verified: true, gloryDelta };
  return json(res);
}

/* ---------------------------------------------------------------- Larry's playback line */

const faceSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);

/** POST /api/checkins/playback: only what the line needs. No times, no place id, nothing stored. */
export const playbackSchema = z.strictObject({
  placeName: z.string().trim().min(1).max(120),
  visits: z.number().int().min(1).max(100_000),
  stage: z.enum(STAGES).nullable().optional(),
  stageEarned: z.boolean().optional(),
  guess: faceSchema.optional(),
  reality: faceSchema.optional(),
  glad: z.enum(["yes", "meh", "no"]).optional(),
  saidHi: z.boolean().optional(),
  mood: z.enum(MOODS).optional(),
});
export type PlaybackInput = z.infer<typeof playbackSchema>;

const cleanName = (s: string) => s.replace(/[\p{C}<>\[\]{}]/gu, "").trim().slice(0, 80);

/**
 * The fixed line for a branch, used when the model can't run. Guess vs Reality rules: numbers and
 * faces only when reality met or beat the guess; a worse visit is about the place, never the person.
 */
export function playbackFallback(i: PlaybackInput): { line: string; plain: string } {
  const place = cleanName(i.placeName) || "this place";
  if (i.guess && i.reality && i.reality < i.guess) return { line: "One rough visit tells us about the place, not you.", plain: "A hard visit is about the place, not you." };
  if (i.guess && i.reality && i.reality >= i.guess)
    return i.saidHi
      ? { line: "Your worry undersold it. People usually like us more than we think after a chat.", plain: "It went better than you guessed." }
      : { line: "Your worry undersold it. Happens a lot.", plain: "It went better than you guessed." };
  if (i.stageEarned && i.stage) return { line: `${place} has a new ${titleWord(i.stage)}. It's you.`, plain: `You're a ${titleWord(i.stage)} at ${place} now.` };
  if (i.saidHi) return { line: `You went to ${place} and said hi. That's two brave things before lunch.`, plain: `You went and said hi. Both count.` };
  return { line: `You showed up at ${place}. That's the hard part done.`, plain: `You went to ${place}. It counts.` };
}

/** A model line breaks the rules if a worse visit gets numbers or faces, or it runs long. */
function linePasses(line: string, i: PlaybackInput): boolean {
  if (!line || line.length > 200) return false;
  const worse = !!(i.guess && i.reality && i.reality < i.guess);
  if (worse && (/\d/.test(line) || /\b(guess|awful|not great|failed|worse)\b/i.test(line))) return false;
  return true;
}

/**
 * Larry's playback line (Larry test): wittyLine("playback") from the real place and the stage just
 * reached, with the mood. The Guess vs Reality branch rules are checked on the answer; a line that
 * breaks them, or no model at all, gives the fixed line for that branch.
 */
export async function playback(i: PlaybackInput, budget?: WittyOpts["budget"]): Promise<WittyResult> {
  const items: SharedItem[] = [{ name: cleanName(i.placeName), kind: "place" }];
  if (i.stageEarned && i.stage) items.push({ name: titleWord(i.stage), kind: "title" });
  try {
    const out = await wittyLine("playback", items, { ...(i.mood ? { mood: i.mood } : {}), ...(budget ? { budget } : {}) });
    if (out.source === "model" && linePasses(out.line, i)) return out;
  } catch {
    // The fixed line below.
  }
  return { ...playbackFallback(i), source: "fallback" };
}
