// Makes access codes: `npm run codes -- <count> --cents 25 [--note judges]`.
// Prints the new codes once; only their hashes (with budget and spend) are stored, in
// .data/access-codes.json or Upstash when UPSTASH_REDIS_REST_URL/TOKEN are set.
// `npm run codes -- --status` shows how much each stored code has spent (by hash prefix only).
// Reads ../.env or .env for the Upstash settings. Never prints secrets.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { hashAccessCode, newAccessCode } from "@/lib/access/codes";
import { codeStoreKind, codesFile, getCodeStore } from "@/lib/access/store";
import { CODE_BUDGET_CENTS } from "@/lib/contracts";

const MAX_COUNT = 500;

function loadEnv() {
  for (const file of [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "../.env")]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m || line.trimStart().startsWith("#")) continue;
      const value = m[2].replace(/^(['"])(.*)\1$/, "$2");
      if (process.env[m[1]] === undefined) process.env[m[1]] = value;
    }
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? "") : undefined;
}

function usage(msg?: string): never {
  if (msg) console.error(msg);
  console.error("Usage: npm run codes -- <count> [--cents 25] [--note label]\n       npm run codes -- --status");
  process.exit(1);
}

const where = () => (codeStoreKind() === "upstash" ? "Upstash Redis" : path.relative(process.cwd(), codesFile()));

async function status() {
  const all = Object.entries(await getCodeStore().list());
  if (!all.length) {
    console.log(`No codes stored in ${where()}.`);
    return;
  }
  console.log(`${all.length} code(s) in ${where()}:`);
  for (const [hash, r] of all.sort((a, b) => a[1].createdAt - b[1].createdAt)) {
    const spent = Math.min(r.spentCents, r.budgetCents);
    const state = r.spentCents >= r.budgetCents ? "used up" : `${(r.budgetCents - spent).toFixed(1)}c left`;
    console.log(`  ${hash.slice(0, 8)}  ${r.spentCents.toFixed(2)}c of ${r.budgetCents}c  ${state}${r.note ? `  (${r.note})` : ""}`);
  }
}

async function create() {
  const countArg = process.argv.slice(2).find((a, i, all) => /^\d+$/.test(a) && all[i - 1] !== "--cents");
  const count = Number(countArg);
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) usage(`Give a count from 1 to ${MAX_COUNT}.`);
  const centsRaw = arg("--cents");
  const cents = centsRaw === undefined ? CODE_BUDGET_CENTS : Number(centsRaw);
  if (!Number.isFinite(cents) || cents <= 0 || cents > 10_000) usage("--cents must be a positive number (at most 10000).");
  const note = (arg("--note") ?? "").replace(/[^\w .-]/g, "").slice(0, 40) || undefined;

  const codes = new Set<string>();
  while (codes.size < count) codes.add(newAccessCode());
  const now = Date.now();
  const entries = [...codes].map((code) => ({
    code,
    hash: hashAccessCode(code)!,
    record: { budgetCents: cents, spentCents: 0, createdAt: now, ...(note ? { note } : {}) },
  }));
  const added = await getCodeStore().add(entries.map(({ hash, record }) => ({ hash, record })));
  if (added !== entries.length) {
    // A hash collision with an existing code is astronomically unlikely; never print a code that wasn't saved.
    console.error(`Only ${added} of ${entries.length} codes were new. Run again.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Made ${added} code(s), ${cents} cents of AI time each, stored as hashes in ${where()}.`);
  console.log("Copy them now. They are not saved anywhere and can't be shown again.\n");
  for (const e of entries) console.log(e.code);
}

async function main() {
  loadEnv();
  if (process.argv.includes("--status")) return status();
  return create();
}

main().catch((err) => {
  console.error("[codes] Failed:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
