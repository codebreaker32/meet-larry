import "server-only";
import { after } from "next/server";
import { z } from "zod";
import { MESSAGE_MAX, RECENT_PLACES_MAX } from "@/lib/chat-protocol";
import type { GroupGround, GroupMember } from "@/lib/contracts";
import type { RequestSignals } from "@/lib/types/signals";

/** Finds a room's ground; `signals` is the room's Hidden Gems blend (roomSignals), never anyone's age. */
export type GroundFind = (members: GroupMember[], signals?: RequestSignals) => Promise<GroupGround>;
import { errorResponse, optionalCharge } from "@/lib/http";
import { findGroupCommonGround } from "@/lib/qloo";
import { e2eGround } from "./e2e-hooks";
import { locationSchema, personaSchema, profileSchema, signalsSchema } from "@/lib/schemas";
import type { RoomSignals } from "./store";
import { parseRoomCode } from "./codes";
import { RoomLimitError, recordMiss, tooManyMisses } from "./limits";
import { RoomError, notFound } from "./service";
import { RoomStoreError } from "./store";

// Shared by the /api/rooms route handlers: body parsing, schemas and error responses.

/** A profile is at most 20 picks and a persona at most 300 likes; anything this big is not a real request. */
const BODY_MAX = 400_000;

export const NO_STORE = { "Cache-Control": "no-store" } as const;

/** A random id the phone made for itself (no account). Only its HMAC is stored, for Block. */
export const deviceIdSchema = z.string().regex(/^[\w-]{8,100}$/);

/**
 * The member's own signals. Only mood (blended in counts) and Hidden Gems are kept, server-side and
 * never shown; the age range is dropped here and never reaches a room.
 */
const roomSignalsSchema = signalsSchema.transform((s): RoomSignals => ({
  ...(s.mood ? { mood: s.mood } : {}),
  ...(s.hiddenGems !== undefined ? { hiddenGems: s.hiddenGems } : {}),
}));

export const joinBodySchema = z.object({ profile: profileSchema, deviceId: deviceIdSchema.optional(), signals: roomSignalsSchema.optional() });

const credentialFields = {
  memberId: z.string().max(40),
  token: z.string().max(200),
};

export const leaveBodySchema = z.object(credentialFields);

export const messageBodySchema = z.object({
  ...credentialFields,
  // Longer text is cut, never rejected (the crisis check still reads the first MESSAGE_MAX * 2).
  text: z.string().transform((t) => t.slice(0, MESSAGE_MAX * 2)),
  toLarry: z.boolean(),
  /** Typed while this phone showed Larry as excused: kept from Larry whatever the room says now. */
  excused: z.boolean().optional(),
  /** Optional: lets Larry find places near the group. */
  location: locationSchema.optional(),
  /** Optional: the asker's persona (sent only with messages for Larry). */
  persona: personaSchema.optional(),
  /** Optional: the asker's mood and Hidden Gems (age is dropped). Never shown to the others. */
  signals: roomSignalsSchema.optional(),
  /** Optional: place ids this phone was shown lately (chat-protocol RECENT_PLACES_MAX). */
  recentPlaces: z.array(z.string().regex(/^[\w.:-]{1,64}$/)).max(RECENT_PLACES_MAX).optional(),
});

/** "Excuse Larry" (away: true) and "Hello Larry" (away: false). */
export const larryBodySchema = z.object({
  ...credentialFields,
  away: z.boolean(),
});

export async function readJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length") ?? 0) > BODY_MAX) throw new RoomError(413, "That was too big to send.");
  const raw = await request.text();
  if (raw.length > BODY_MAX) throw new RoomError(413, "That was too big to send.");
  return JSON.parse(raw);
}

export interface CodeParams {
  params: Promise<{ code: string }>;
}

/**
 * The room code from the URL. Throws 404 for anything that can't be a code, and 429 for an IP
 * that has looked up too many codes that don't exist (checked before the lookup).
 */
export async function codeFrom(request: Request, ctx: CodeParams): Promise<string> {
  if (tooManyMisses(request)) throw new RoomLimitError();
  const code = parseRoomCode((await ctx.params).code);
  if (!code) {
    recordMiss(request);
    throw notFound();
  }
  return code;
}

/** A request that needs an access code and has none (or a spent one): carries requireCode's answer. */
export class RoomAccessError extends Error {
  constructor(readonly response: Response) {
    super("Access code needed");
  }
}

/** JSON error response for room failures; anything else goes to the shared mapper. */
export function roomErrorResponse(err: unknown, request?: Request): Response {
  if (err instanceof RoomAccessError) return err.response;
  if (err instanceof RoomError) {
    if (err.status === 404 && request) recordMiss(request);
    return Response.json({ error: err.message }, { status: err.status, headers: NO_STORE });
  }
  if (err instanceof RoomLimitError) {
    return Response.json({ error: err.message }, { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } });
  }
  if (err instanceof RoomStoreError) {
    console.error(err.message);
    return Response.json({ error: "Rooms aren't working right now. Try again soon." }, { status: 503, headers: NO_STORE });
  }
  return errorResponse(err);
}

/** Runs `task` after the response is sent (Next's after()), or straight away outside a request (tests). */
/**
 * How the room's common ground is found for this request: the e2e stand-in, or Qloo with Larry's
 * curation charged to the request's access code when it has a usable one (Qloo's ranking otherwise).
 */
export async function groundFinder(request: Request): Promise<GroundFind | undefined> {
  const fake = e2eGround(request);
  if (fake) return fake;
  const charge = await optionalCharge(request);
  return (members, signals) => findGroupCommonGround(members, undefined, { ...(charge ? { charge } : { curate: false }), ...(signals ? { signals } : {}) });
}

export function runAfter(task: () => Promise<void>) {
  try {
    after(task);
  } catch {
    void task();
  }
}
