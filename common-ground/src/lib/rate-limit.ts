import "server-only";

// In-memory rate limits per client IP: a token bucket for bursts plus an optional daily cap.
// Per server instance only (serverless hosts may run several), which is enough to stop one
// person or script from draining the AI budget or the Qloo key.

export const RATE_LIMIT_MESSAGE = "Lots of messages at once. Wait a minute, then try again.";

interface Limit {
  /** Requests allowed at once. */
  burst: number;
  /** Tokens added per second. */
  refillPerSec: number;
  /** Requests allowed per IP per UTC day, if set. */
  daily?: number;
}

export const LIMITS = {
  chat: { burst: 8, refillPerSec: 1 / 6, daily: 150 },
  qloo: { burst: 30, refillPerSec: 2 },
  /** Model calls on the optional-AI routes (curation, place fits). Over it, the route answers without the model. */
  curate: { burst: 6, refillPerSec: 1 / 10, daily: 100 },
} satisfies Record<string, Limit>;

interface Bucket {
  tokens: number;
  updated: number;
  day: string;
  dayCount: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;
const IDLE_MS = 24 * 60 * 60 * 1000;
let lastPrune = 0;

/**
 * Client IP from proxy headers. Only headers our own proxy sets are trusted, because a client can
 * send any header it likes:
 *   - the LAST x-forwarded-for entry by default. Caddy's reverse_proxy (no trusted_proxies) replaces
 *     any client-sent x-forwarded-for with the real peer address; Vercel appends the real one. The
 *     first entry is whatever the client sent, so it is never used.
 *   - x-vercel-forwarded-for only with TRUST_VERCEL_IP=1 (the app runs on Vercel, which sets it).
 *   - x-real-ip only with TRUST_REAL_IP=1 (the proxy overwrites it, e.g. Caddy's
 *     `header_up X-Real-IP {remote_host}`), or outside production (tests and e2e use it to get a
 *     fresh bucket per test).
 * "local" when there is none.
 */
export function clientIp(request: Request): string {
  const h = request.headers;
  const first = (v: string | null) => v?.split(",")[0]?.trim();
  const last = (v: string | null) => v?.split(",").at(-1)?.trim();
  const trustVercel = process.env.TRUST_VERCEL_IP === "1";
  const trustRealIp = process.env.TRUST_REAL_IP === "1" || process.env.NODE_ENV !== "production";
  const ip =
    (trustVercel ? first(h.get("x-vercel-forwarded-for")) : undefined) ||
    (trustRealIp ? h.get("x-real-ip")?.trim() : undefined) ||
    last(h.get("x-forwarded-for"));
  return (ip || "local").slice(0, 64);
}

function prune(now: number) {
  if (now - lastPrune < 60_000 && buckets.size < MAX_BUCKETS) return;
  lastPrune = now;
  for (const [key, b] of buckets) if (now - b.updated > IDLE_MS) buckets.delete(key);
  // Still too many (e.g. spoofed IPs): drop the oldest. Maps iterate in insertion order.
  for (const key of buckets.keys()) {
    if (buckets.size <= MAX_BUCKETS * 0.9) break;
    buckets.delete(key);
  }
}

/** Takes one token for `key`. Returns true when the request may go ahead. */
export function take(key: string, limit: Limit, now = Date.now()): boolean {
  prune(now);
  const day = new Date(now).toISOString().slice(0, 10);
  let b = buckets.get(key);
  if (!b) {
    b = { tokens: limit.burst, updated: now, day, dayCount: 0 };
  } else {
    // Re-insert so the map stays ordered by last use, oldest first.
    buckets.delete(key);
    b.tokens = Math.min(limit.burst, b.tokens + ((now - b.updated) / 1000) * limit.refillPerSec);
    b.updated = now;
    if (b.day !== day) {
      b.day = day;
      b.dayCount = 0;
    }
  }
  buckets.set(key, b);
  if (b.tokens < 1) return false;
  if (limit.daily !== undefined && b.dayCount >= limit.daily) return false;
  b.tokens -= 1;
  b.dayCount += 1;
  return true;
}

/** Forgets every bucket. For tests. */
export function resetRateLimits() {
  buckets.clear();
}

/** A 429 response if this request is over the limit, else null. */
export function rateLimit(request: Request, name: keyof typeof LIMITS): Response | null {
  if (allow(request, name)) return null;
  return Response.json({ error: RATE_LIMIT_MESSAGE }, { status: 429, headers: { "Retry-After": "60" } });
}

/** True when this request may go ahead under limit `name` (one token taken). */
export function allow(request: Request, name: keyof typeof LIMITS): boolean {
  return take(`${name}:${clientIp(request)}`, LIMITS[name]);
}
