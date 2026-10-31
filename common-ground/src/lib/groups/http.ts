import "server-only";
import { after } from "next/server";
import { z } from "zod";
import { codeHold, requireCode } from "@/lib/access";
import { getSession } from "@/lib/account/session";
import { RUN_ESTIMATE_USD } from "@/lib/budget";
import { MESSAGE_MAX } from "@/lib/chat-protocol";
import { codeBusyResponse, errorResponse, leaseCode, optionalCharge } from "@/lib/http";
import { LIMITS, RATE_LIMIT_MESSAGE, take } from "@/lib/rate-limit";
import { e2eGround } from "@/lib/rooms/e2e-hooks";
import { findGroupCommonGround } from "@/lib/qloo";
import { locationSchema, personaSchema, profileSchema, signalsSchema } from "@/lib/schemas";
import type { Session } from "@/lib/types/account";
import { GROUP_COPY, GROUP_REPORT_REASONS, GROUP_SIZES, type GroupSize } from "./shared";
import { type GroundFind, GroupError, type MemberSignals, type RunCharge, openGroup } from "./service";
import { isGroupId } from "./token";

// Shared by the /api/groups route handlers: who is asking, body schemas, limits and error answers.

export const NO_STORE = { "Cache-Control": "no-store" } as const;
const BODY_MAX = 200_000;

/** The signed-in 18+ account, or a 401 with the warm "accounts only" line. */
export async function requireSession(request: Request): Promise<Session> {
  const s = await getSession(request).catch(() => null);
  if (!s) throw new GroupError(401, GROUP_COPY.needAccount);
  return s;
}

export async function readJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length") ?? 0) > BODY_MAX) throw new GroupError(413, "That was too big to send.");
  const raw = await request.text();
  if (raw.length > BODY_MAX) throw new GroupError(413, "That was too big to send.");
  try {
    return JSON.parse(raw);
  } catch {
    throw new GroupError(400, "Hmm, that didn't go through. Try again?");
  }
}

/** Only mood and Hidden Gems are kept (server-side, never shown); the age range is dropped here. */
const memberSignalsSchema = signalsSchema.transform((s): MemberSignals => ({
  ...(s.mood ? { mood: s.mood } : {}),
  ...(s.hiddenGems !== undefined ? { hiddenGems: s.hiddenGems } : {}),
}));

export const createSchema = z.object({
  size: z
    .number()
    .int()
    .refine((n) => (GROUP_SIZES as readonly number[]).includes(n))
    .transform((n) => n as GroupSize),
  profile: profileSchema,
  signals: memberSignalsSchema.optional(),
});

export const joinSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), token: z.string().max(200) }),
  z.object({ action: z.literal("join"), token: z.string().max(200), profile: profileSchema, signals: memberSignalsSchema.optional() }),
]);

export const messageSchema = z.object({
  text: z.string().transform((t) => t.slice(0, MESSAGE_MAX * 2)),
  // The sender's own point, for their request only: rounded again here to about 1 km.
  location: locationSchema.transform((l) => ({ lat: Math.round(l.lat * 100) / 100, lon: Math.round(l.lon * 100) / 100 })).optional(),
  persona: personaSchema.optional(),
  signals: memberSignalsSchema.optional(),
});

export const memberActionSchema = z.object({
  action: z.enum(["remove", "unfriend", "block", "report"]),
  memberId: z.string().regex(/^[A-Za-z0-9_-]{4,40}$/),
  reason: z.enum(GROUP_REPORT_REASONS).optional(),
  note: z.string().max(300).optional(),
});

export interface IdParams {
  params: Promise<{ id: string }>;
}

export async function groupIdFrom(ctx: IdParams): Promise<string> {
  const id = (await ctx.params).id;
  if (!isGroupId(id)) throw new GroupError(404, GROUP_COPY.notMember);
  return id;
}

/* ---------------------------------------------------------------- limits (per account) */

const GROUP_LIMITS = {
  create: { burst: 5, refillPerSec: 1 / 120, daily: 40 },
  join: { burst: 10, refillPerSec: 1 / 10, daily: 200 },
  poll: { burst: 90, refillPerSec: 3 },
  manage: { burst: 20, refillPerSec: 1 / 5, daily: 400 },
  message: { burst: 15, refillPerSec: 1 / 3, daily: 1000 },
  groupMessage: { burst: 30, refillPerSec: 1 },
  groupLarry: { burst: 6, refillPerSec: 1 / 10, daily: 200 },
  crisis: { burst: 6, refillPerSec: 1 / 20 },
} as const;

export class GroupLimitError extends Error {
  constructor() {
    super(RATE_LIMIT_MESSAGE);
  }
}

export function takeLimit(uid: string, name: keyof typeof GROUP_LIMITS | "larry", groupId?: string) {
  let ok: boolean;
  if (name === "larry") ok = take(`chat:acct:${uid}`, LIMITS.chat) && (!groupId || take(`group-larry:${groupId}`, GROUP_LIMITS.groupLarry));
  else if (name === "message") ok = take(`group-msg:${uid}`, GROUP_LIMITS.message) && (!groupId || take(`group-msgs:${groupId}`, GROUP_LIMITS.groupMessage));
  else ok = take(`group-${name}:${uid}`, GROUP_LIMITS[name]);
  if (!ok) throw new GroupLimitError();
}

/* ---------------------------------------------------------------- Larry time and the ground */

/** A request without Larry time: carries requireCode's answer (401/402). */
export class GroupAccessError extends Error {
  constructor(readonly response: Response) {
    super("Larry time needed");
  }
}

/** Charges a Larry run to the asker's account (Larry time), with one-of-a-few runs at once. */
export function authorizeFor(request: Request): () => Promise<RunCharge> {
  return async () => {
    const access = await requireCode(request);
    if (access instanceof Response) throw new GroupAccessError(access);
    const lease = await leaseCode(access.code, RUN_ESTIMATE_USD);
    if (!lease) throw new GroupAccessError(codeBusyResponse());
    return {
      wrap: (hold) => {
        const wrapped = codeHold(access.code, hold);
        return {
          ...wrapped,
          release: () => {
            wrapped.release();
            lease.release();
          },
        };
      },
      charge: lease.charge,
    };
  };
}

/** The e2e stand-in, or Qloo with Larry's curation charged to this request's account when it has time left. */
export async function groundFinderFor(request: Request): Promise<{ find: GroundFind; charge?: (usd: number) => void | Promise<void>; fake: boolean }> {
  const fake = e2eGround(request);
  if (fake) return { find: fake, fake: true };
  const charge = await optionalCharge(request);
  return {
    find: (members, signals) => findGroupCommonGround(members, undefined, { ...(charge ? { charge } : { curate: false }), ...(signals ? { signals } : {}) }),
    ...(charge ? { charge } : {}),
    fake: false,
  };
}

/** Larry's opening, after the response is sent. */
export function openAfter(request: Request, id: string) {
  runAfter(async () => {
    const { find, charge, fake } = await groundFinderFor(request);
    await openGroup(id, { find, ...(charge ? { charge } : {}), ...(fake ? { fixedOpener: true } : {}) });
  });
}

export function runAfter(task: () => Promise<void>) {
  try {
    after(task);
  } catch {
    void task();
  }
}

/* ---------------------------------------------------------------- errors */

export function groupErrorResponse(err: unknown): Response {
  if (err instanceof GroupAccessError) return err.response;
  if (err instanceof GroupError) return Response.json({ error: err.message }, { status: err.status, headers: NO_STORE });
  if (err instanceof GroupLimitError) return Response.json({ error: err.message }, { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } });
  if (err instanceof z.ZodError) return Response.json({ error: "Hmm, that didn't go through. Try again?" }, { status: 400, headers: NO_STORE });
  return errorResponse(err);
}
