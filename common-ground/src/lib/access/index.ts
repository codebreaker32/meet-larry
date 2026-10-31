import "server-only";
import { ACCOUNT_BUDGET_CENTS, chargeAccount } from "@/lib/account/service";
import { getSession } from "@/lib/account/session";
import { type BudgetHold, costOf } from "@/lib/budget";
import { getRepo } from "@/lib/db";
import { clientIp } from "@/lib/rate-limit";
import { CODE_BUDGET_CENTS } from "@/lib/contracts";
import { hashAccessCode, usdToCents } from "./codes";
import { ACCESS_HEADER, ACCESS_TEXT, type AccessState, CODE_HEADER, normalizeAccessCode } from "./shared";
import { CodeStoreError, getCodeStore } from "./store";

// Larry time: every AI route asks for it (requireCode) and charges what the model cost
// (chargeCode, or codeHold around the route's budget hold). Routes that need no AI never ask.
// Two sources, one contract:
//   - an account (Authorization: Bearer <Firebase ID token>): code "acct:<uid>", charged to
//     accounts/{uid}.budgetCentsLeft (25 cents each, never below 0). The default for people.
//   - an access code (x-larry-code): kept for the CLI and people without an account.
// Callers never need to know which: the code string is opaque to them.
//
//   const access = await requireCode(request);
//   if (access instanceof Response) return access;
//   const hold = codeHold(access.code, await holdBudget());
//   ... runGroupChat(input, onProgress, { budget: hold }) ...

export { ACCESS_HEADER, ACCESS_TEXT, CODE_HEADER, type AccessState } from "./shared";
export { CODE_BUDGET_CENTS };

/** Used in development with LARRY_ALLOW_NO_CODE=1 when no valid code was sent. Never charged. */
export const DEV_CODE = "LARRY-DEV";

/** Wrong codes allowed per client in the window before requireCode answers 429. */
const GUESS_LIMIT = 20;
const GUESS_WINDOW_MS = 10 * 60 * 1000;
const TOO_MANY_TEXT = "Too many wrong codes. Wait a few minutes, then try again.";

/** True when local testing may skip codes: LARRY_ALLOW_NO_CODE=1 outside production. */
export function allowNoCode(): boolean {
  return process.env.LARRY_ALLOW_NO_CODE === "1" && process.env.NODE_ENV !== "production";
}

/** Codes that stand for an account's Larry time: "acct:<uid>". Made only by requireCode, never typed. */
export const ACCOUNT_CODE_PREFIX = "acct:";
const accountUid = (code: string) => (code.startsWith(ACCOUNT_CODE_PREFIX) ? code.slice(ACCOUNT_CODE_PREFIX.length) : null);
/** True for a raw value that claims to be an account code. Only the server may make one. */
export const looksLikeAccountCode = (raw: unknown) => typeof raw === "string" && raw.trim().toLowerCase().startsWith(ACCOUNT_CODE_PREFIX);

export type CodeCheck =
  | { ok: true; code: string; budgetCents: number; spentCents: number }
  | { ok: false; state: AccessState };

/** Looks a code up. Never throws for a bad code; storage failures do throw (CodeStoreError). */
export async function checkCode(raw: unknown): Promise<CodeCheck> {
  if (raw === undefined || raw === null || raw === "") return { ok: false, state: "missing" };
  const uid = typeof raw === "string" ? accountUid(raw) : null;
  if (uid !== null) return checkAccount(uid);
  const code = normalizeAccessCode(raw);
  const hash = code && hashAccessCode(code);
  if (!code || !hash) return { ok: false, state: "invalid" };
  const rec = await getCodeStore().get(hash);
  if (!rec) return { ok: false, state: "invalid" };
  if (rec.spentCents >= rec.budgetCents) return { ok: false, state: "spent" };
  return { ok: true, code, budgetCents: rec.budgetCents, spentCents: rec.spentCents };
}

/** An account's Larry time, in the same shape as a code's. Spend is what is gone from the 25 cents. */
async function checkAccount(uid: string): Promise<CodeCheck> {
  const a = uid ? await getRepo().accounts.get(uid) : null;
  if (!a) return { ok: false, state: "invalid" };
  if (a.budgetCentsLeft <= 0) return { ok: false, state: "spent" };
  const budgetCents = Math.max(ACCOUNT_BUDGET_CENTS, a.budgetCentsLeft);
  return { ok: true, code: `${ACCOUNT_CODE_PREFIX}${uid}`, budgetCents, spentCents: budgetCents - a.budgetCentsLeft };
}

/** The JSON answer for a request without a usable code: 401 missing/invalid, 402 spent. */
export function accessDenied(state: AccessState): Response {
  return Response.json(
    { error: ACCESS_TEXT[state], access: state },
    { status: state === "spent" ? 402 : 401, headers: { [ACCESS_HEADER]: state, "Cache-Control": "no-store" } },
  );
}

/* ---------------------------------------------------------------- wrong-guess limit */

const g = globalThis as typeof globalThis & { __larryCodeMisses?: Map<string, { count: number; since: number }> };
const misses = (g.__larryCodeMisses ??= new Map());

/** True when this client has guessed wrong too often lately. */
export function tooManyMisses(key: string, now = Date.now()): boolean {
  const m = misses.get(key);
  if (!m) return false;
  if (now - m.since > GUESS_WINDOW_MS) {
    misses.delete(key);
    return false;
  }
  return m.count >= GUESS_LIMIT;
}

/** Counts one wrong code for this client. */
export function recordMiss(key: string, now = Date.now()) {
  if (misses.size > 10_000) misses.clear();
  const m = misses.get(key);
  if (!m || now - m.since > GUESS_WINDOW_MS) misses.set(key, { count: 1, since: now });
  else m.count++;
}

/** Empties the wrong-guess counters. For tests. */
export function resetMisses() {
  misses.clear();
}

/* ---------------------------------------------------------------- the route guard */

/**
 * Checks the request's Larry time. A signed-in account with time left wins and gets
 * `{ code: "acct:<uid>" }`; otherwise the x-larry-code header is checked and `{ code }` (canonical)
 * comes back. Else a Response to send as it is: 401 when nothing usable was sent, 402 when the
 * account's or code's time is used up, 429 after too many wrong codes, 503 if storage is down.
 */
export async function requireCode(request: Request): Promise<{ code: string } | Response> {
  const rawHeader = request.headers.get(CODE_HEADER)?.trim() ?? "";
  // Account codes are made here from a verified token, never taken from a header.
  const raw = looksLikeAccountCode(rawHeader) ? "LARRY-not-a-code" : rawHeader;
  let accountSpent = false;
  if (request.headers.has("authorization")) {
    try {
      const session = await getSession(request);
      if (session) {
        const acct = await checkAccount(session.uid);
        if (acct.ok) return { code: acct.code };
        accountSpent = acct.state === "spent";
      }
    } catch (err) {
      console.error("Account check failed:", err instanceof Error ? err.message : err);
    }
    // A spent account with no code to fall back on hears about its own Larry time.
    if (accountSpent && !raw) return allowNoCode() ? { code: DEV_CODE } : accessDenied("spent");
  }
  const ip = `code:${clientIp(request)}`;
  if (raw && tooManyMisses(ip)) {
    return Response.json({ error: TOO_MANY_TEXT }, { status: 429, headers: { "Retry-After": "600" } });
  }
  let check: CodeCheck;
  try {
    check = await checkCode(raw);
  } catch (err) {
    console.error("Access code check failed:", err instanceof CodeStoreError ? err.message : err);
    if (allowNoCode()) return { code: DEV_CODE };
    return Response.json({ error: "Larry's AI isn't available right now. Try again later." }, { status: 503 });
  }
  if (check.ok) return { code: check.code };
  if (check.state === "invalid") recordMiss(ip);
  if (allowNoCode()) return { code: DEV_CODE };
  return accessDenied(check.state);
}

/**
 * Adds `usd` of AI spend to the code, atomically (an in-process queue plus a lock file, or one
 * Redis script). Never throws: a failed charge is logged without the code and the reply still goes out.
 */
export async function chargeCode(code: string, usd: number): Promise<void> {
  if (code === DEV_CODE) return;
  const cents = usdToCents(usd);
  const uid = accountUid(code);
  if (uid !== null) {
    if (!uid || cents <= 0) return;
    try {
      await chargeAccount(uid, cents);
    } catch (err) {
      console.error("Could not charge an account's Larry time:", err instanceof Error ? err.message : err);
    }
    return;
  }
  const hash = hashAccessCode(code);
  if (!hash || cents <= 0) return;
  try {
    await getCodeStore().charge(hash, cents);
  } catch (err) {
    console.error("Could not charge an access code:", err instanceof Error ? err.message : err);
  }
}

/** Thrown by codeHold().check() when the code's AI time ran out during a run. */
export class CodeSpentError extends Error {
  constructor() {
    super(ACCESS_TEXT.spent);
    this.name = "CodeSpentError";
  }
}

/**
 * Wraps a budget hold (from holdBudget) so every model response is also charged to the code, and
 * check() (called between tool rounds) stops the run once the code's AI time is used up.
 * Pass it as `{ budget }` to runGroupChat; release it as usual.
 */
export function codeHold(code: string, base: BudgetHold): BudgetHold {
  return {
    async record(usage) {
      const total = await base.record(usage);
      await chargeCode(code, costOf(usage));
      return total;
    },
    async check() {
      await base.check();
      if (code === DEV_CODE) return;
      const c = await checkCode(code).catch(() => null);
      if (c && !c.ok && c.state === "spent") throw new CodeSpentError();
    },
    release: () => base.release(),
  };
}
