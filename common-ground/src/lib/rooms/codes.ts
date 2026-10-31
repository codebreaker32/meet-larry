import "server-only";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

// Room codes, member ids and join tokens. Codes are short enough to read out loud, and random
// enough (32^6, about a billion) that guessing one is hopeless behind the join rate limit.

/** No 0/O or 1/I, so a code read off a screen can't be typed wrong. 32 symbols. */
export const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const CODE_LENGTH = 6;
export const CODE_PREFIX = "LARRY-";

const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

/** A fresh room code from a crypto random source, e.g. "K7QM3X". */
export function newRoomCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/** "K7QM3X" -> "LARRY-K7QM3X", the form people see and share. */
export function displayCode(code: string): string {
  return CODE_PREFIX + code;
}

/**
 * The bare code from anything a person might type or a link might carry (R3, on the server so every
 * path gets it): "larry-k7qm3x", "LARRY K7QM 3X", "Larry–K7QM.3X", "k7qm3x", full-width letters
 * from a phone keyboard. Case never matters, any spaces or punctuation are ignored, and the LARRY
 * prefix is optional (a code that itself starts with LARRY still works). The alphabet has no 0, O,
 * 1 or I at all, so those can never be mistyped into a different room. Null when it can't be a code.
 */
export function parseRoomCode(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.length > 40) return null;
  const s = raw.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]+/g, "");
  if (CODE_RE.test(s)) return s;
  if (s.startsWith("LARRY") && CODE_RE.test(s.slice(5))) return s.slice(5);
  return null;
}

/** A member id that is unique within a room. Not secret. */
export function newMemberId(): string {
  return "m_" + randomBytes(6).toString("base64url");
}

/** A join token for one member's device: 32 random bytes. Only its hash is stored. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time check of a presented token against a stored hash. */
export function tokenMatches(token: unknown, storedHash: string | undefined): boolean {
  if (typeof token !== "string" || !token || token.length > 200 || !storedHash) return false;
  const a = Buffer.from(hashToken(token), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
