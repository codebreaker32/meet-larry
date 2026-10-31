import "server-only";
import { ComprehendClient, DetectPiiEntitiesCommand } from "@aws-sdk/client-comprehend";

// Amazon Comprehend DetectPiiEntities (D22): catches phone numbers, addresses, emails, links,
// usernames and payment or ID numbers in a chat message, also when they are written out in a way
// the regex check misses. It ADDS to src/lib/meet/red-flags.ts, never replaces it.
//  - Server only. Credentials are the dedicated IAM user's keys from the environment
//    (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION), passed explicitly so no other local
//    profile is ever picked up. They never reach the client, a log or a response.
//  - Synchronous call: AWS does not keep the text. We never log it either, only the error name.
//  - Fails open: no keys, a timeout or any error answers null, and the caller keeps the regex result.
//    After a failure it rests for a minute, so a down service never slows a chat.

/** What Larry cares about, from Comprehend's entity types. */
export type PiiKind = "contact" | "address" | "payment" | "id";

export interface PiiHit {
  kind: PiiKind;
  /** Comprehend's type, e.g. PHONE. Never the text itself. */
  type: string;
}

const KIND_OF: Record<string, PiiKind> = {
  PHONE: "contact",
  EMAIL: "contact",
  URL: "contact",
  USERNAME: "contact",
  IP_ADDRESS: "contact",
  ADDRESS: "address",
  BANK_ACCOUNT_NUMBER: "payment",
  BANK_ROUTING: "payment",
  CREDIT_DEBIT_NUMBER: "payment",
  CREDIT_DEBIT_CVV: "payment",
  CREDIT_DEBIT_EXPIRY: "payment",
  PIN: "payment",
  PASSWORD: "payment",
  INTERNATIONAL_BANK_ACCOUNT_NUMBER: "payment",
  SWIFT_CODE: "payment",
  IN_AADHAAR: "id",
  IN_PERMANENT_ACCOUNT_NUMBER: "id",
  IN_VOTER_NUMBER: "id",
  IN_NREGA: "id",
  PASSPORT_NUMBER: "id",
  DRIVER_ID: "id",
  SSN: "id",
  UK_NATIONAL_INSURANCE_NUMBER: "id",
  UK_NATIONAL_HEALTH_SERVICE_NUMBER: "id",
  CA_SOCIAL_INSURANCE_NUMBER: "id",
};

/** Below this confidence a hit is ignored (fewer false alarms on ordinary chat). */
export const PII_MIN_SCORE = 0.8;
/** Comprehend is asked about at most this much of a message. */
const TEXT_MAX = 2000;
const TIMEOUT_MS = 1500;
const REST_MS = 60_000;

/** A street-level address, not a neighbourhood or the venue: a number, or a street or flat word. */
const STREETISH = /\d|\b(road|rd|street|st|lane|ln|marg|flat|apartment|apt|block|sector|floor|building|bldg|tower|house|nagar|colony|society|cross|main|avenue|ave|plot|wing|pin\s*code|postcode|zip)\b/i;

export interface PiiEntity {
  Type?: string;
  Score?: number;
  BeginOffset?: number;
  EndOffset?: number;
}

/** Comprehend's entities -> the hits that matter. Pure; exported for tests. `ignore`: names that are fine (the venue). */
export function hitsFrom(text: string, entities: PiiEntity[] | undefined, ignore: string[] = []): PiiHit[] {
  const out: PiiHit[] = [];
  const skip = ignore.map((n) => n.toLowerCase()).filter(Boolean);
  for (const e of entities ?? []) {
    const kind = e.Type ? KIND_OF[e.Type] : undefined;
    if (!kind || (e.Score ?? 0) < PII_MIN_SCORE) continue;
    const span = typeof e.BeginOffset === "number" && typeof e.EndOffset === "number" ? text.slice(e.BeginOffset, e.EndOffset) : "";
    if (kind === "address") {
      // "Meet at the cafe" or "I'm in Bandra" is fine; a street, flat or house number is not.
      if (!STREETISH.test(span)) continue;
      if (skip.some((n) => span.toLowerCase().includes(n) || n.includes(span.toLowerCase()))) continue;
    }
    if (!out.some((h) => h.kind === kind)) out.push({ kind, type: e.Type! });
  }
  return out;
}

/** Sends text to Comprehend and returns its entities. Injected in tests. */
export type DetectPii = (text: string, signal: AbortSignal) => Promise<PiiEntity[] | undefined>;

const g = globalThis as typeof globalThis & { __larryComprehend?: ComprehendClient; __larryPiiRestUntil?: number };

/** True when the server has the IAM user's keys and a region. */
export const comprehendConfigured = () => !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.AWS_REGION);

const realDetect: DetectPii = async (text, signal) => {
  g.__larryComprehend ??= new ComprehendClient({
    region: process.env.AWS_REGION,
    credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID!, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY! },
    maxAttempts: 1,
  });
  const out = await g.__larryComprehend.send(new DetectPiiEntitiesCommand({ Text: text, LanguageCode: "en" }), { abortSignal: signal });
  return out.Entities;
};

/**
 * The PII in a message, by kind, or null when Comprehend couldn't be asked (not configured, resting
 * after a failure, timed out, any error). Null means "use the regex result alone". Never throws,
 * never logs the text.
 */
export async function detectPii(text: string, opts: { detect?: DetectPii; ignore?: string[] } = {}): Promise<PiiHit[] | null> {
  const clean = String(text ?? "").normalize("NFKC").slice(0, TEXT_MAX).trim();
  if (!clean) return [];
  const detect = opts.detect ?? (comprehendConfigured() && !process.env.VITEST ? realDetect : null);
  if (!detect) return null;
  if (!opts.detect && (g.__larryPiiRestUntil ?? 0) > Date.now()) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return hitsFrom(clean, await detect(clean, ctrl.signal), opts.ignore);
  } catch (err) {
    if (!opts.detect) g.__larryPiiRestUntil = Date.now() + REST_MS;
    console.warn("PII check skipped:", err instanceof Error ? err.name : "unknown");
    return null;
  } finally {
    clearTimeout(timer);
  }
}
