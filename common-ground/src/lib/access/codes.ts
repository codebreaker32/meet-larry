// Making and hashing access codes. Only hashes are ever stored; the codes themselves are printed
// once by `npm run codes` and never written anywhere.
import { createHash, randomInt } from "node:crypto";
import { ACCESS_CODE_ALPHABET, ACCESS_CODE_CHARS, normalizeAccessCode } from "./shared";

/** A fresh code from a crypto random source, e.g. "LARRY-7K2P-Q9XM". */
export function newAccessCode(rand: (max: number) => number = randomInt): string {
  let body = "";
  for (let i = 0; i < ACCESS_CODE_CHARS; i++) body += ACCESS_CODE_ALPHABET[rand(ACCESS_CODE_ALPHABET.length)];
  return normalizeAccessCode(body)!;
}

/**
 * SHA-256 of the canonical code with a fixed label, as hex. Any way of typing the same code gives
 * the same hash; anything that isn't a code gives null.
 */
export function hashAccessCode(raw: string): string | null {
  const code = normalizeAccessCode(raw);
  if (!code) return null;
  return createHash("sha256").update(`larry-access-code:v1:${code}`).digest("hex");
}

/** Codes are shown with cents; spend is kept in fractional cents so many small calls add up right. */
export function usdToCents(usd: number): number {
  return Number.isFinite(usd) && usd > 0 ? usd * 100 : 0;
}
