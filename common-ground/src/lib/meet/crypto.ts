import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Hashing for Open to meet. Nothing here can be turned back into a device id, a pick list or a
// person: everything stored is an HMAC with a server secret.
//
// MEET_SECRET (32+ characters) must be set wherever more than one server instance runs (Upstash):
// without it each instance makes its own random secret, which is fine on one dev server only.

const g = globalThis as typeof globalThis & { __larryMeetSecret?: string };

function secret(): string {
  const env = process.env.MEET_SECRET;
  if (env && env.length >= 32) return env;
  if (process.env.NODE_ENV === "production" && process.env.UPSTASH_REDIS_REST_URL) {
    // Shared storage with a per-instance secret would give different anon ids on each instance.
    throw new Error("MEET_SECRET must be set (32+ characters) when Open to meet uses Upstash");
  }
  return (g.__larryMeetSecret ??= randomBytes(32).toString("base64url"));
}

function hmac(purpose: string, ...parts: string[]): string {
  // The purpose and a separator that can't appear in the parts keep different uses apart.
  return createHmac("sha256", secret()).update([purpose, ...parts].join("\u0000")).digest("base64url");
}

/**
 * The id a viewer sees for someone at a venue. It depends on the viewer's own visit, the venue
 * and the other person's visit, so two viewers see different ids for the same person, and the
 * same person gets a new id at every venue and every visit: nobody can be followed around.
 */
export function anonIdFor(viewerSid: string, placeId: string, targetSid: string): string {
  return "a_" + hmac("anon", viewerSid, placeId, targetSid).slice(0, 16);
}

/**
 * The id a viewer sees for one shared thing at a venue ("2 people here like Ghibli"). Like an
 * anon id it depends on the viewer's visit and the venue, so it can't be followed anywhere.
 */
export function groupIdFor(viewerSid: string, placeId: string, key: string): string {
  return "g_" + hmac("group", viewerSid, placeId, key).slice(0, 16);
}

/** A device id as stored: an HMAC, never the id itself. */
export function deviceHash(deviceId: string): string {
  return hmac("device", deviceId).slice(0, 24);
}

/** One pick as stored with a block: an HMAC of its Qloo id, so a block list never lists anyone's taste. */
export function itemHash(id: string): string {
  return hmac("item", id).slice(0, 12);
}

/** The whole set of picks as one value (order doesn't matter). Matches the same persona on any phone. */
export function personaFingerprint(ids: string[]): string {
  const sorted = [...new Set(ids)].sort();
  return "p_" + hmac("persona", ...sorted).slice(0, 24);
}

/** Key for a once-per-visit record (one wave from one device to another at one venue). */
export function pairKey(purpose: string, ...parts: string[]): string {
  return hmac(purpose, ...parts).slice(0, 24);
}

/** A random id for a visit (internal, never sent to anyone). */
export const newSid = () => "s_" + randomBytes(12).toString("base64url");
/** The bearer token a phone holds for its visit. Only its hash is stored. */
export const newSessionToken = () => randomBytes(32).toString("base64url");
export const newReportId = () => "r_" + randomBytes(9).toString("base64url");

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Constant-time check of a presented session token against its stored hash. */
export function sessionMatches(token: unknown, storedHash: string | undefined): boolean {
  if (typeof token !== "string" || !token || token.length > 200 || !storedHash) return false;
  const a = Buffer.from(sha256(token), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
