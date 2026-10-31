import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let file = "";

/** A fresh copy of the module, reading the env as it is now. */
async function load(limit?: string) {
  vi.resetModules();
  vi.stubEnv("ANTHROPIC_SPEND_FILE", file);
  if (limit !== undefined) vi.stubEnv("ANTHROPIC_BUDGET_USD", limit);
  return import("./budget");
}
const spent = async () => JSON.parse(await fs.readFile(file, "utf8")).usd as number;
// $4 per million input tokens: 250,000 input tokens cost exactly $1.
const ONE_DOLLAR = { input_tokens: 250_000 };

beforeEach(async () => {
  file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "larry-budget-")), "spend.json");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(path.dirname(file), { recursive: true, force: true });
});

describe("parseBudget", () => {
  it("reads plain numbers, dollar signs and commas", async () => {
    const { parseBudget } = await load();
    expect(parseBudget("60")).toBe(60);
    expect(parseBudget("$60")).toBe(60);
    expect(parseBudget(" 1,000 ")).toBe(1000);
    expect(parseBudget("12.5")).toBe(12.5);
  });
  it("falls back to $60 for empty, junk, zero or negative values", async () => {
    const { parseBudget } = await load();
    for (const v of [undefined, "", "abc", "0", "-5", "NaN"]) expect(parseBudget(v)).toBe(60);
  });
  it("keeps the guard on when the env says $2", async () => {
    const { holdBudget, recordUsage, BudgetExceededError } = await load("$2");
    await recordUsage({ input_tokens: 500_000 });
    await expect(holdBudget()).rejects.toBeInstanceOf(BudgetExceededError);
  });
});

describe("spend tracking", () => {
  it("never loses spend when many responses are recorded at once", async () => {
    const { recordUsage } = await load("100");
    await Promise.all(Array.from({ length: 20 }, () => recordUsage(ONE_DOLLAR)));
    expect(await spent()).toBeCloseTo(20, 6);
  });

  it("holds an estimate so concurrent runs can't all pass the check", async () => {
    const { holdBudget, BudgetExceededError } = await load("1");
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => holdBudget(0.25)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: expect.any(BudgetExceededError) });
  });

  it("gives the hold back on release, and counts real spend against it first", async () => {
    const { holdBudget } = await load("1");
    const first = await holdBudget(0.5);
    await expect(holdBudget(0.5)).rejects.toThrow();
    await first.record({ input_tokens: 25_000 }); // $0.10 of the $0.50 hold is now real spend
    first.release();
    const second = await holdBudget(0.5);
    await expect(second.check()).resolves.toBeUndefined();
    second.release();
    second.release(); // safe twice
    expect(await spent()).toBeCloseTo(0.1, 6);
  });

  it("check() fails between tool rounds once the budget is used up", async () => {
    const { holdBudget, BudgetExceededError } = await load("1");
    const hold = await holdBudget(0.25);
    await hold.record(ONE_DOLLAR);
    await expect(hold.check()).rejects.toBeInstanceOf(BudgetExceededError);
    hold.release();
  });
});
