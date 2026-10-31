import "server-only";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

// In-app spending guard for the chat's Anthropic key. Backup only: the hard cap is the
// workspace spend limit set in the Anthropic Console. Spend is kept in a small JSON file,
// so it survives restarts on one server but is per-instance on serverless hosts.

const DEFAULT_LIMIT_USD = 60;

/** "60", "$60" or "1,000" → a positive number; anything else (empty, "abc", 0, -5) → 60. */
export function parseBudget(raw: string | undefined): number {
  const n = Number.parseFloat((raw ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LIMIT_USD;
}

const LIMIT_USD = parseBudget(process.env.ANTHROPIC_BUDGET_USD);
const FILE = process.env.ANTHROPIC_SPEND_FILE ?? path.join(os.tmpdir(), "larry-anthropic-spend.json");

// Claude Opus 5.5 list prices, USD per million tokens.
const RATE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };

/**
 * Held back before a chat run starts, so concurrent requests can't all pass the check and then
 * spend together. A run is up to 4 model calls of a few thousand input tokens each (~$0.15).
 */
export const RUN_ESTIMATE_USD = 0.25;

export class BudgetExceededError extends Error {
  constructor() {
    super(`Chat budget of $${LIMIT_USD} reached`);
  }
}

interface Usage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function costOf(usage: Usage): number {
  return (
    ((usage.input_tokens ?? 0) * RATE.input +
      (usage.output_tokens ?? 0) * RATE.output +
      (usage.cache_read_input_tokens ?? 0) * RATE.cacheRead +
      (usage.cache_creation_input_tokens ?? 0) * RATE.cacheWrite) /
    1_000_000
  );
}

async function readSpent(): Promise<number> {
  try {
    const { usd } = JSON.parse(await fs.readFile(/*turbopackIgnore: true*/ FILE, "utf8"));
    return typeof usd === "number" && Number.isFinite(usd) ? usd : 0;
  } catch {
    return 0;
  }
}

// Every read-modify-write of the spend file runs one at a time, so concurrent requests can't
// overwrite each other's spend. (Per process; serverless instances each keep their own file.)
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

/** Money held back by runs still in progress, in this process. */
let reserved = 0;

async function writeSpent(usd: number) {
  // Write then rename, so a reader never sees a half-written file (which would read as $0).
  const tmp = `${FILE}.${process.pid}.tmp`;
  await fs.writeFile(/*turbopackIgnore: true*/ tmp, JSON.stringify({ usd, limit: LIMIT_USD, updatedAt: new Date().toISOString() }));
  await fs.rename(/*turbopackIgnore: true*/ tmp, /*turbopackIgnore: true*/ FILE);
}

/** Throws if the budget is used up, counting money held by runs in progress. */
export async function assertBudget(extra = 0) {
  if ((await readSpent()) + reserved + extra >= LIMIT_USD) throw new BudgetExceededError();
}

/** Adds the cost of one API response to the running total. Returns the new total. */
export function recordUsage(usage: Usage): Promise<number> {
  return addSpend(costOf(usage));
}

/** Adds `cost` to the file, then runs `after` (still in the queue, so no check sees it twice or not at all). */
function addSpend(cost: number, after?: () => void): Promise<number> {
  return serial(async () => {
    const usd = (await readSpent()) + cost;
    await writeSpent(usd);
    after?.();
    return usd;
  });
}

export interface BudgetHold {
  /** Records one response's cost; it comes out of this hold first. */
  record(usage: Usage): Promise<number>;
  /** Throws BudgetExceededError if the budget is now used up. Call between tool rounds. */
  check(): Promise<void>;
  /** Gives back whatever is left of the hold. Safe to call more than once. */
  release(): void;
}

/**
 * Checks the budget and holds `estimate` back for one chat run. Throws BudgetExceededError if
 * spent + held + estimate would reach the limit. Always `release()` the hold when the run ends.
 */
export function holdBudget(estimate = RUN_ESTIMATE_USD): Promise<BudgetHold> {
  return serial(async () => {
    await assertBudget(estimate);
    reserved += estimate;
    let left = estimate;
    const giveBack = (usd: number) => {
      const n = Math.min(left, usd);
      left -= n;
      reserved = Math.max(0, reserved - n);
    };
    return {
      record(usage) {
        const cost = costOf(usage);
        return addSpend(cost, () => giveBack(cost));
      },
      check: () => assertBudget(),
      release: () => giveBack(left),
    };
  });
}
