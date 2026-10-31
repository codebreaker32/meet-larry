import "server-only";
import { z } from "zod";
import { chargeCode, requireCode } from "@/lib/access";
import { getSession } from "@/lib/account/session";
import type { Session } from "@/lib/types/account";
import { errorResponse } from "@/lib/http";
import { clientIp, RATE_LIMIT_MESSAGE, take } from "@/lib/rate-limit";
import { RoomError } from "@/lib/rooms/service";
import { cleanName } from "@/lib/sanitize";
import { tasteItemSchema } from "@/lib/schemas";
import { REPORT_REASONS } from "./config";
import { MeetStoreError, meetStoreKind } from "./kv";
import { MeetError, NEEDS_ACCOUNT } from "./service";
import { parseWhere, type Where, WHERE_HEADER } from "./presence";
import { PLACE_ID_RE, VenueError } from "./venue";

// Shared by the /api/meet route handlers: schemas, rate limits, the access-code guard and errors.

export const NO_STORE = { "Cache-Control": "no-store" } as const;
const BODY_MAX = 200_000;

const deviceIdSchema = z.string().regex(/^[\w-]{8,100}$/);
const sessionIdSchema = z.string().min(10).max(200);
const groupIdSchema = z.string().regex(/^g_[\w-]{8,40}$/);

/** Only the name and picks are read from a persona; notes, dislikes and the rest stay on the phone. */
const personaSchema = z.object({
  name: z
    .string()
    .max(200)
    .transform((n) => cleanName(n) || "Friend"),
  likes: z
    .array(tasteItemSchema)
    .max(500)
    .transform((items) => items.filter((i) => i.name)),
});

export const openBodySchema = z.object({
  deviceId: deviceIdSchema,
  persona: personaSchema,
  /** The person confirmed they are 18 or over. Anything but true is refused (with a clear message). */
  adult: z.unknown(),
  /** { lat, lon, accuracy }: checked against the venue and thrown away (see presence.ts). */
  where: z.unknown().optional(),
  /** The sealed token from /api/checkins/arrive at this venue (a verified check-in here). */
  visitToken: z.string().max(2000).optional(),
});

export const sessionBodySchema = z.object({ sessionId: sessionIdSchema });
export const waveBodySchema = z.object({ sessionId: sessionIdSchema, groupId: groupIdSchema, where: z.unknown().optional() });

const roomCredsSchema = z.object({
  code: z.string().max(20),
  memberId: z.string().max(40),
  token: z.string().max(200),
});

/** From the nearby list ({ sessionId, groupId }) or from inside a room ({ room, targetMemberId }). */
const safetyTargetSchema = z.union([
  z.object({ sessionId: sessionIdSchema, groupId: groupIdSchema }),
  z.object({ room: roomCredsSchema, targetMemberId: z.string().max(40), deviceId: deviceIdSchema.optional() }),
]);

export const blockBodySchema = safetyTargetSchema;
export const reportBodySchema = z.intersection(
  safetyTargetSchema,
  z.object({
    reason: z.enum(REPORT_REASONS),
    note: z
      .string()
      .max(1000)
      .optional()
      .transform((n) => n?.replace(/[\p{C}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 300) || undefined),
  }),
);

/** The phone's fix from a body field or the x-meet-where header; null when absent or malformed. */
export function whereFrom(request: Request, bodyWhere?: unknown): Where | null {
  return parseWhere(bodyWhere ?? request.headers.get(WHERE_HEADER));
}

export async function readJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length") ?? 0) > BODY_MAX) throw new MeetError(413, "That was too big to send.");
  const raw = await request.text();
  if (raw.length > BODY_MAX) throw new MeetError(413, "That was too big to send.");
  return JSON.parse(raw);
}

/** The place id from the URL, or a 404. */
export async function placeFrom(ctx: { params: Promise<{ placeId: string }> }): Promise<string> {
  const placeId = decodeURIComponent((await ctx.params).placeId);
  if (!PLACE_ID_RE.test(placeId)) throw new MeetError(404, "We couldn't find this place.");
  return placeId;
}

/* ---------------------------------------------------------------- rate limits (per IP, code and phone) */

const MEET_LIMITS = {
  /** Switching on: a few times a day is plenty. Per IP, per access code and per phone. */
  open: { burst: 5, refillPerSec: 1 / 120, daily: 40 },
  openCode: { burst: 12, refillPerSec: 1 / 120, daily: 60 },
  openDevice: { burst: 4, refillPerSec: 1 / 300, daily: 20 },
  /** Polling the nearby list every 15 s, a few phones on one Wi-Fi. */
  poll: { burst: 30, refillPerSec: 1 / 2 },
  /** Waves: also limited per visit in the service. */
  wave: { burst: 5, refillPerSec: 1 / 30, daily: 60 },
  /** Venue look-ups (Qloo). */
  venue: { burst: 10, refillPerSec: 1 / 10, daily: 200 },
  /** Block and report: generous, they must always work, but not a flood. */
  safety: { burst: 20, refillPerSec: 1 / 5 },
} as const;

export class MeetLimitError extends Error {
  constructor() {
    super(RATE_LIMIT_MESSAGE);
  }
}

export function takeMeetLimit(request: Request, name: keyof typeof MEET_LIMITS) {
  if (!take(`meet-${name}:${clientIp(request)}`, MEET_LIMITS[name])) throw new MeetLimitError();
}

/** Switching on is also limited per access code and per phone, not only per network. */
export function takeOpenLimits(code: string, deviceId: string) {
  if (!take(`meet-open-code:${code}`, MEET_LIMITS.openCode)) throw new MeetLimitError();
  if (!take(`meet-open-device:${deviceId}`, MEET_LIMITS.openDevice)) throw new MeetLimitError();
}

/* ---------------------------------------------------------------- durable storage (fail closed) */

/**
 * Blocks must last for good, so strangers may only meet where storage is durable and shared:
 * Firestore (the app's database) or Upstash, plus a fixed MEET_SECRET so stored hashes still match
 * after a restart or on another instance. In production without both, switching on, the list and
 * waving are refused (503). Close always works; Block and Report still run (they also take someone
 * out of a room), but no strangers can meet in the first place. Development and tests use memory
 * or Firestore, whichever the app's database is.
 */
export function meetStorageReady(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const secret = process.env.MEET_SECRET ?? "";
  return meetStoreKind() !== "memory" && secret.length >= 32;
}

export function assertMeetStorage() {
  if (!meetStorageReady()) throw new MeetStoreError("Open to meet needs durable storage (Firestore or Upstash) and MEET_SECRET (32+ characters)");
}

/* ---------------------------------------------------------------- access code */

/**
 * Open to meet leads to a chat with Larry (AI), so switching on, the nearby list and waving need
 * an access code (CONTRACT: src/lib/contracts.ts). Close, Block and Report never do: safety and
 * switching off must always work.
 */
export async function requireMeetCode(request: Request): Promise<{ code: string } | Response> {
  return requireCode(request);
}

/* ---------------------------------------------------------------- 18+ account */

/**
 * Open to meet is for signed-in accounts only, and accounts are 18+ (D4, D18). The demo account
 * gets no exemption here: it follows every rule (D19). A Response (401) when there is no account.
 */
export async function requireMeetAccount(request: Request): Promise<Session | Response> {
  const session = await getSession(request).catch(() => null);
  if (session?.isAdult === true) return session;
  return Response.json({ error: NEEDS_ACCOUNT, reason: "account" }, { status: 401, headers: NO_STORE });
}

/** Charges Larry's witty lines on the list to the viewer's Larry time. */
export const meetBudget = (code: string) => ({ charge: (usd: number) => chargeCode(code, usd) });

/* ---------------------------------------------------------------- errors */

export function meetErrorResponse(err: unknown): Response {
  if (err instanceof MeetError || err instanceof VenueError || err instanceof RoomError) {
    return Response.json({ error: err.message }, { status: err.status, headers: NO_STORE });
  }
  if (err instanceof MeetLimitError) {
    return Response.json({ error: err.message }, { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } });
  }
  if (err instanceof MeetStoreError) {
    console.error(err.message);
    return Response.json({ error: "Open to meet isn't working right now. Try again soon." }, { status: 503, headers: NO_STORE });
  }
  return errorResponse(err);
}
