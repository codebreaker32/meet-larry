import "server-only";
import { LIMITS, RATE_LIMIT_MESSAGE, clientIp, take } from "../rate-limit";

// Rate limits for rooms, per IP and per room, on top of the shared token buckets in rate-limit.ts.
// Asking Larry uses the same per-IP "chat" bucket as /api/chat, so rooms can't be used to get
// around the chat limit.

const ROOM_LIMITS = {
  /** New rooms from one IP. */
  create: { burst: 5, refillPerSec: 1 / 60, daily: 60 },
  /** Join attempts from one IP; also what makes guessing codes hopeless. */
  join: { burst: 10, refillPerSec: 1 / 10, daily: 200 },
  /** Polling: up to 5 phones on one Wi-Fi, each every couple of seconds. */
  poll: { burst: 90, refillPerSec: 4 },
  /** Messages from one IP. */
  message: { burst: 15, refillPerSec: 1 / 3, daily: 1000 },
  /** Messages in one room, from everyone. */
  roomMessage: { burst: 30, refillPerSec: 1 },
  /** Larry runs in one room. */
  roomLarry: { burst: 6, refillPerSec: 1 / 10, daily: 200 },
  /** Crisis replies cost nothing, so this only stops a flood of them. */
  crisis: { burst: 6, refillPerSec: 1 / 20 },
} as const;

export type RoomLimitName = keyof typeof ROOM_LIMITS;

export class RoomLimitError extends Error {
  constructor() {
    super(RATE_LIMIT_MESSAGE);
  }
}

/** Takes one token; throws RoomLimitError when over the limit. */
export function takeRoomLimit(request: Request, name: RoomLimitName | "larry", code?: string) {
  const ip = clientIp(request);
  let ok: boolean;
  if (name === "larry") {
    ok = take(`chat:${ip}`, LIMITS.chat) && (!code || take(`room-larry:${code}`, ROOM_LIMITS.roomLarry));
  } else if (name === "message") {
    ok = take(`room-msg:${ip}`, ROOM_LIMITS.message) && (!code || take(`room-msgs:${code}`, ROOM_LIMITS.roomMessage));
  } else {
    ok = take(`room-${name}:${ip}`, ROOM_LIMITS[name]);
  }
  if (!ok) throw new RoomLimitError();
}

/* Lookups of codes that don't exist. Past MISS_MAX in MISS_WINDOW_MS, an IP gets no more
 * lookups at all (checked before the lookup, so a guesser can't learn hits from misses). */
const MISS_MAX = 30;
const MISS_WINDOW_MS = 10 * 60 * 1000;
const misses = new Map<string, { count: number; since: number }>();

export function tooManyMisses(request: Request, now = Date.now()): boolean {
  const m = misses.get(clientIp(request));
  return !!m && now - m.since < MISS_WINDOW_MS && m.count >= MISS_MAX;
}

export function recordMiss(request: Request, now = Date.now()) {
  const ip = clientIp(request);
  const m = misses.get(ip);
  if (!m || now - m.since >= MISS_WINDOW_MS) {
    if (misses.size > 10_000) misses.clear();
    misses.set(ip, { count: 1, since: now });
  } else {
    m.count += 1;
  }
}
