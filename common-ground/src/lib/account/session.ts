import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { getRepo } from "../db";
import { E2E_TOKEN_PREFIX } from "../firebase/config";
import type { GetSession, Session } from "../types/account";

// Who is asking (D18). The client sends `Authorization: Bearer <Firebase ID token>`; the server
// verifies it with firebase-admin verifyIdToken on every request (no session cookie). Fake
// `e2e:<uid>` tokens are accepted only when NODE_ENV !== "production" and E2E=1 (Playwright).
// A Session is built ONLY by sessionFromClaims, so isDemo is always worked out here, on the server,
// from the verified phone claim. Tokens and phone numbers are never logged.

export type { Session };

/** The verified token claims a Session is built from (firebase-admin DecodedIdToken has both). */
export interface VerifiedClaims {
  uid: string;
  /** E.164, present on phone-auth tokens. Read here only; never stored, returned or logged. */
  phone_number?: string;
}

/** "+91 98-76 (54)..." -> "+919876..."; anything that isn't a plausible E.164 number -> null. */
function normalisePhone(raw: string | undefined): string | null {
  if (typeof raw !== "string") return null;
  const p = raw.replace(/[\s().-]/g, "");
  return /^\+[1-9]\d{6,14}$/.test(p) ? p : null;
}

const digest = (s: string) => createHash("sha256").update(s).digest();

/**
 * D19: true only when this verified phone number is the one demo/testing account's, env DEMO_PHONE.
 * Unset or malformed DEMO_PHONE means no account is the demo account. Constant-time compare; neither
 * number is ever logged or echoed.
 */
export function isDemoPhone(phone: string | undefined, demoPhone: string | undefined = process.env.DEMO_PHONE): boolean {
  const want = normalisePhone(demoPhone);
  const got = normalisePhone(phone);
  if (!want || !got) return false;
  return timingSafeEqual(digest(want), digest(got));
}

/** The only way to make a Session: from claims a verifier has already checked. Accounts are 18+. */
export function sessionFromClaims(claims: VerifiedClaims): Session {
  return { uid: claims.uid, isAdult: true, isDemo: isDemoPhone(claims.phone_number) };
}

/**
 * D19: may this request skip the check-in location, closed-now and dwell checks? Only the demo
 * account's verified session. Grants nothing else: every privacy and consent rule still applies.
 */
export const isDemoAccount = (session: Session | null | undefined): boolean => session?.isDemo === true;

/** True when fake e2e tokens may be accepted: E2E=1, never in production. */
export const e2eTokensAllowed = () => process.env.E2E === "1" && process.env.NODE_ENV !== "production";

const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;
/** Firebase ID tokens are JWTs well under this; anything longer is not one. */
const TOKEN_MAX = 4096;

/** The bearer token on a request, or null. */
export function bearerToken(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (!h) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  return m && m[1].length <= TOKEN_MAX ? m[1] : null;
}

/**
 * Verifies the request's bearer token and returns its claims, or null (no token, a bad or expired
 * token). Signed in is not the same as having an account: sign-up (POST /api/account) needs this
 * before the account exists. Everything else should use getSession.
 */
export async function verifyRequest(req: Request): Promise<VerifiedClaims | null> {
  const token = bearerToken(req);
  if (!token) return null;
  if (token.startsWith(E2E_TOKEN_PREFIX)) {
    const uid = token.slice(E2E_TOKEN_PREFIX.length);
    if (!e2eTokensAllowed() || !UID_RE.test(uid)) return null;
    // e2e only: one chosen uid stands in for the demo account (E2E_DEMO_UID + a fake DEMO_PHONE).
    const demo = process.env.E2E_DEMO_UID === uid && process.env.DEMO_PHONE;
    return demo ? { uid, phone_number: process.env.DEMO_PHONE } : { uid };
  }
  try {
    const { adminAuth } = await import("../firebase/admin");
    const decoded = await adminAuth().verifyIdToken(token);
    return { uid: decoded.uid, ...(typeof decoded.phone_number === "string" ? { phone_number: decoded.phone_number } : {}) };
  } catch (err) {
    // The reason only (expired, wrong project); never the token.
    const code = (err as { code?: string }).code;
    if (code !== "auth/id-token-expired" && code !== "auth/argument-error") console.warn("ID token not accepted:", code ?? "unknown");
    return null;
  }
}

/**
 * The signed-in account behind this request, or null. A verified token with no account yet (sign-up
 * not finished, or turned away by the 18+ check) is still null, so isAdult is always true.
 */
export const getSession: GetSession = async (req) => {
  const claims = await verifyRequest(req);
  if (!claims) return null;
  const account = await getRepo().accounts.get(claims.uid);
  return account ? sessionFromClaims(claims) : null;
};
