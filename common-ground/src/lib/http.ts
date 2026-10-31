import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { ZodError } from "zod";
import { ACCESS_TEXT, CodeSpentError, DEV_CODE, chargeCode, checkCode, requireCode } from "./access";
import { usdToCents } from "./access/codes";
import { BudgetExceededError } from "./budget";
import type { Charge } from "./suggest";
import { QlooError } from "./qloo";
import { LIMITS, allow } from "./rate-limit";

// Error text is shown to people in the app, so it is short and easy-read. Details go to the log.

/** Map a known failure to an easy-read message and an HTTP status. */
export function describeError(err: unknown): { status: number; error: string } {
  if (err instanceof ZodError) return { status: 400, error: "That didn't work. Try again." };
  if (err instanceof SyntaxError) return { status: 400, error: "That didn't work. Try again." };
  if (err instanceof BodyTooLargeError) return { status: 413, error: "That was too much to send. Try a shorter one." };
  if (err instanceof CodeSpentError) return { status: 402, error: ACCESS_TEXT.spent };
  if (err instanceof BudgetExceededError) {
    return { status: 429, error: "Chat is paused for now. This demo has used its AI budget." };
  }
  if (err instanceof QlooError) {
    console.error(err.message);
    if (err.status === 429) return { status: 429, error: "Larry's a little busy finding things right now. Try again in a minute?" };
    return { status: err.status >= 500 || err.status < 400 ? 502 : err.status, error: "Larry couldn't look that up just now. Try again?" };
  }
  if (err instanceof Anthropic.AuthenticationError) {
    console.error("Anthropic authentication failed: check ANTHROPIC_API_KEY");
    return { status: 503, error: "Chat isn't working right now. Try again later." };
  }
  if (err instanceof Anthropic.RateLimitError) return { status: 429, error: "Larry is busy. Try again in a moment." };
  if (err instanceof Anthropic.APIError) {
    console.error(`Anthropic request failed (${err.status}): ${err.message}`);
    return { status: 502, error: "Larry couldn't answer. Try again." };
  }
  console.error(err);
  return { status: 500, error: "Something went wrong. Try again." };
}

/** Map known failures to a JSON error response. */
export function errorResponse(err: unknown): Response {
  const { status, error } = describeError(err);
  if (err instanceof ZodError && process.env.NODE_ENV !== "production") {
    // Paths only, to help local debugging; no values are echoed back.
    return Response.json({ error, issues: err.issues.map((i) => ({ path: i.path, code: i.code })) }, { status });
  }
  return Response.json({ error }, { status });
}

/**
 * For routes where AI is optional (common ground, places, suggestions): a charge function when the
 * request has a usable access code, else null, so the route answers without the model (Qloo's own
 * ranking, rule-based fits, fixed suggestions) instead of turning the person away.
 */
export async function optionalCharge(request: Request): Promise<Charge | null> {
  const access = await requireCode(request);
  if (access instanceof Response) return null;
  return (usd: number) => chargeCode(access.code, usd);
}

/* ---------------------------------------------------------------- request bodies */

/** Thrown by readBody when the body is bigger than allowed (413). */
export class BodyTooLargeError extends Error {
  constructor() {
    super("Request body too large");
    this.name = "BodyTooLargeError";
  }
}

/** Default request body cap: far above any real request, far below what could hurt the server. */
export const BODY_MAX_BYTES = 1_000_000;

/**
 * Reads the body as text, stopping (BodyTooLargeError) as soon as it passes `max` bytes. Unlike
 * request.text(), a chunked body with no Content-Length can't make the server buffer gigabytes.
 */
export async function readBody(request: Request, max = BODY_MAX_BYTES): Promise<string> {
  if (Number(request.headers.get("content-length") ?? 0) > max) throw new BodyTooLargeError();
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLargeError();
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/** readBody, parsed as JSON (SyntaxError -> 400). */
export async function readJsonBody(request: Request, max = BODY_MAX_BYTES): Promise<unknown> {
  return JSON.parse(await readBody(request, max));
}

/* ---------------------------------------------------------------- per-code leases */

/**
 * AI runs allowed at once on one access code. requireCode only checks the spend when a request
 * arrives, and spend is added after each model response, so without this many concurrent
 * requests on one code would all pass and overshoot its budget many times over.
 */
export const CODE_RUNS_MAX = 3;
/** The e2e suite shares one big-budget code across parallel workers (dev server only). */
const runsMax = () => (process.env.E2E === "1" && process.env.NODE_ENV !== "production" ? 50 : CODE_RUNS_MAX);
/** A lease nobody released (a crashed run) frees itself after this long; routes run at most 60 s. */
const LEASE_TTL_MS = 2 * 60 * 1000;

interface Lease {
  cents: number;
  expires: number;
}
const lg = globalThis as typeof globalThis & { __larryCodeLeases?: Map<string, Set<Lease>> };
const leases = (lg.__larryCodeLeases ??= new Map());

function liveLeases(code: string, now: number): Set<Lease> {
  const set = leases.get(code) ?? new Set<Lease>();
  for (const l of set) if (l.expires <= now) set.delete(l);
  if (set.size) leases.set(code, set);
  else leases.delete(code);
  return set;
}

/** A reservation on a code for one AI run. `charge` bills the code; always call `release`. */
export interface CodeLease {
  code: string;
  charge: Charge;
  /** Gives the reservation back. Safe to call more than once. */
  release(): void;
}

/**
 * Reserves room on `code` for one AI run estimated at `estimateUsd`. Null when CODE_RUNS_MAX
 * runs are already going on it, or when what is spent plus what is already reserved uses up its
 * budget. The reservation is min(estimate, what is left), so a nearly spent code still gets one
 * run at a time (as before), but never several at once. In-process: the web app is one process.
 */
export async function leaseCode(code: string, estimateUsd: number, now = Date.now()): Promise<CodeLease | null> {
  const charge: Charge = (usd) => chargeCode(code, usd);
  if (code === DEV_CODE) return { code, charge, release: () => {} };
  const check = await checkCode(code);
  if (!check.ok) return null;
  // No await between this check and the reservation, so concurrent requests can't both pass.
  const set = liveLeases(code, now);
  const reserved = [...set].reduce((sum, l) => sum + l.cents, 0);
  const left = check.budgetCents - check.spentCents - reserved;
  if (set.size >= runsMax() || left <= 0) return null;
  const lease: Lease = { cents: Math.min(Math.max(usdToCents(estimateUsd), 1), left), expires: now + LEASE_TTL_MS };
  set.add(lease);
  leases.set(code, set);
  return {
    code,
    charge,
    release: () => {
      set.delete(lease);
      if (!set.size && leases.get(code) === set) leases.delete(code);
    },
  };
}

/** Forgets every lease. For tests. */
export function resetCodeLeases() {
  leases.clear();
}

/** The answer when a code already has CODE_RUNS_MAX runs going (or its budget is all reserved). */
export function codeBusyResponse(): Response {
  return Response.json(
    { error: "Larry is still answering. Wait for that reply, then try again." },
    { status: 429, headers: { "Retry-After": "10", "Cache-Control": "no-store" } },
  );
}

/**
 * For routes where AI is optional: a lease on the request's access code when it has a usable one
 * with room for this run, else null, so the route answers without the model. Release it when done.
 */
export async function optionalLease(
  request: Request,
  estimateUsd: number,
  opts: { limit?: keyof typeof LIMITS } = {},
): Promise<CodeLease | null> {
  const access = await requireCode(request);
  if (access instanceof Response) return null;
  // The per-IP model-call limit (if any) is only spent when the request could use the model.
  if (opts.limit && !allow(request, opts.limit)) return null;
  return leaseCode(access.code, estimateUsd);
}
