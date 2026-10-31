// Where access-code hashes and their spend live. A JSON file by default
// (.data/access-codes.json, gitignored); Upstash Redis over REST when UPSTASH_REDIS_REST_URL and
// UPSTASH_REDIS_REST_TOKEN are set, so several server instances share one budget per code.
// No "server-only" import, so `npm run codes` can use it too. Never logs codes, URLs or tokens.
import { promises as fs } from "node:fs";
import path from "node:path";

export interface CodeRecord {
  /** The code's AI budget in cents. */
  budgetCents: number;
  /** AI spend charged to the code so far, in (fractional) cents. */
  spentCents: number;
  createdAt: number;
  /** Optional label from `npm run codes -- --note`, e.g. "judges". Never the code. */
  note?: string;
}

export interface CodeStore {
  get(hash: string): Promise<CodeRecord | null>;
  /** Saves new codes; a hash that already exists is left alone. Returns how many were added. */
  add(entries: { hash: string; record: CodeRecord }[]): Promise<number>;
  /** Adds `cents` to the code's spend in one atomic step. Null when there is no such code. */
  charge(hash: string, cents: number): Promise<CodeRecord | null>;
  /** Every stored record by hash (for `npm run codes -- --status`). */
  list(): Promise<Record<string, CodeRecord>>;
}

export class CodeStoreError extends Error {}

const HASH_RE = /^[0-9a-f]{64}$/;

function cleanRecord(r: unknown): CodeRecord | null {
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  const budgetCents = Number(o.budgetCents);
  const spentCents = Number(o.spentCents);
  if (!Number.isFinite(budgetCents) || budgetCents < 0 || !Number.isFinite(spentCents) || spentCents < 0) return null;
  return {
    budgetCents,
    spentCents,
    createdAt: Number.isFinite(Number(o.createdAt)) ? Number(o.createdAt) : 0,
    ...(typeof o.note === "string" && o.note ? { note: o.note.slice(0, 60) } : {}),
  };
}

/* ---------------------------------------------------------------- JSON file */

interface FileShape {
  version: 1;
  codes: Record<string, CodeRecord>;
}

// One queue per file, so every read-modify-write in this process runs one at a time.
const g = globalThis as typeof globalThis & { __larryCodeQueues?: Map<string, Promise<unknown>> };
const queues = (g.__larryCodeQueues ??= new Map());

function serial<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(file) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  const tail = next.catch(() => {});
  queues.set(file, tail);
  void tail.then(() => {
    if (queues.get(file) === tail) queues.delete(file);
  });
  return next;
}

const LOCK_STALE_MS = 10_000;
const LOCK_WAIT_MS = 5_000;

/**
 * A lock file next to the data file, so `npm run codes` and the server (separate processes) never
 * write at the same time. A lock older than 10s is from a crashed process and is taken over.
 */
async function withFileLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const lock = `${file}.lock`;
  const started = Date.now();
  for (let attempt = 0; ; attempt++) {
    try {
      const handle = await fs.open(/*turbopackIgnore: true*/ lock, "wx");
      await handle.close();
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const stat = await fs.stat(/*turbopackIgnore: true*/ lock).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
        await fs.rm(/*turbopackIgnore: true*/ lock, { force: true });
        continue;
      }
      if (Date.now() - started > LOCK_WAIT_MS) throw new CodeStoreError("Access codes are busy. Try again.");
      await new Promise((r) => setTimeout(r, Math.min(10 * 2 ** attempt, 200)));
    }
  }
  try {
    return await fn();
  } finally {
    await fs.rm(/*turbopackIgnore: true*/ lock, { force: true });
  }
}

async function readFileShape(file: string): Promise<FileShape> {
  let raw: string;
  try {
    raw = await fs.readFile(/*turbopackIgnore: true*/ file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, codes: {} };
    throw new CodeStoreError("Could not read access codes");
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    // Never treat a broken file as empty: that would quietly reset every budget.
    throw new CodeStoreError("Access code file is not valid JSON");
  }
  const codes: Record<string, CodeRecord> = {};
  const src = (data as { codes?: Record<string, unknown> })?.codes ?? {};
  for (const [hash, r] of Object.entries(src)) {
    const rec = cleanRecord(r);
    if (HASH_RE.test(hash) && rec) codes[hash] = rec;
  }
  return { version: 1, codes };
}

async function writeFileShape(file: string, data: FileShape) {
  const dir = path.dirname(file);
  await fs.mkdir(/*turbopackIgnore: true*/ dir, { recursive: true, mode: 0o700 });
  // Keep the folder out of git even if the repo's .gitignore doesn't list it.
  await fs.writeFile(/*turbopackIgnore: true*/ path.join(dir, ".gitignore"), "*\n", { flag: "wx" }).catch(() => {});
  // Write then rename, so a reader never sees a half-written file.
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(/*turbopackIgnore: true*/ tmp, JSON.stringify(data, null, 1), { mode: 0o600 });
  await fs.rename(/*turbopackIgnore: true*/ tmp, /*turbopackIgnore: true*/ file);
}

export function fileCodeStore(file: string): CodeStore {
  const locked = <T>(fn: () => Promise<T>) => serial(file, () => withFileLock(file, fn));
  return {
    async get(hash) {
      if (!HASH_RE.test(hash)) return null;
      // Reads don't need the lock: writes are atomic renames.
      return (await readFileShape(file)).codes[hash] ?? null;
    },
    add(entries) {
      return locked(async () => {
        const data = await readFileShape(file);
        let added = 0;
        for (const { hash, record } of entries) {
          if (!HASH_RE.test(hash) || data.codes[hash]) continue;
          data.codes[hash] = record;
          added++;
        }
        if (added) await writeFileShape(file, data);
        return added;
      });
    },
    charge(hash, cents) {
      return locked(async () => {
        const data = await readFileShape(file);
        const rec = data.codes[hash];
        if (!rec) return null;
        if (cents > 0) {
          rec.spentCents += cents;
          await writeFileShape(file, data);
        }
        return { ...rec };
      });
    },
    async list() {
      return (await readFileShape(file)).codes;
    },
  };
}

/* ---------------------------------------------------------------- Upstash Redis (REST) */

const KEY_PREFIX = "larry:access:";
const INDEX_KEY = "larry:access-index";
const UPSTASH_TIMEOUT_MS = 5_000;

const ADD_SCRIPT = `if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('HSET', KEYS[1], 'b', ARGV[1], 's', '0', 'c', ARGV[2], 'n', ARGV[3])
redis.call('SADD', KEYS[2], ARGV[4])
return 1`;

// HINCRBYFLOAT is atomic; the EXISTS check keeps a charge from creating a code out of nothing.
const CHARGE_SCRIPT = `if redis.call('EXISTS', KEYS[1]) == 0 then return false end
local s = redis.call('HINCRBYFLOAT', KEYS[1], 's', ARGV[1])
return {redis.call('HGET', KEYS[1], 'b'), s, redis.call('HGET', KEYS[1], 'c'), redis.call('HGET', KEYS[1], 'n')}`;

function fromHash(fields: string[] | null): CodeRecord | null {
  if (!fields?.length) return null;
  const m = new Map<string, string>();
  for (let i = 0; i + 1 < fields.length; i += 2) m.set(fields[i], fields[i + 1]);
  return cleanRecord({ budgetCents: m.get("b"), spentCents: m.get("s"), createdAt: m.get("c"), note: m.get("n") });
}

export function upstashCodeStore(url: string, token: string): CodeStore {
  const base = url.replace(/\/+$/, "");

  async function command<T>(args: (string | number)[]): Promise<T> {
    let res: Response;
    try {
      res = await fetch(base, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(args.map(String)),
        cache: "no-store",
        signal: AbortSignal.timeout(UPSTASH_TIMEOUT_MS),
      });
    } catch (err) {
      throw new CodeStoreError(`Access code storage unreachable (${(err as Error).name})`);
    }
    const body = (await res.json().catch(() => null)) as { result?: T; error?: string } | null;
    if (!res.ok || !body || body.error) {
      throw new CodeStoreError(`Access code storage error (${res.status}${body?.error ? `: ${String(body.error).slice(0, 80)}` : ""})`);
    }
    return body.result as T;
  }

  return {
    async get(hash) {
      if (!HASH_RE.test(hash)) return null;
      return fromHash(await command<string[] | null>(["HGETALL", KEY_PREFIX + hash]));
    },
    async add(entries) {
      let added = 0;
      for (const { hash, record } of entries) {
        if (!HASH_RE.test(hash)) continue;
        const r = await command<number>([
          "EVAL", ADD_SCRIPT, 2, KEY_PREFIX + hash, INDEX_KEY, record.budgetCents, record.createdAt, record.note ?? "", hash,
        ]);
        if (r === 1) added++;
      }
      return added;
    },
    async charge(hash, cents) {
      if (!HASH_RE.test(hash)) return null;
      const r = await command<string[] | null>(["EVAL", CHARGE_SCRIPT, 1, KEY_PREFIX + hash, Math.max(0, cents)]);
      if (!r) return null;
      return cleanRecord({ budgetCents: r[0], spentCents: r[1], createdAt: r[2], note: r[3] });
    },
    async list() {
      const out: Record<string, CodeRecord> = {};
      const hashes = await command<string[]>(["SMEMBERS", INDEX_KEY]);
      for (const hash of hashes ?? []) {
        const rec = fromHash(await command<string[] | null>(["HGETALL", KEY_PREFIX + hash]));
        if (rec) out[hash] = rec;
      }
      return out;
    },
  };
}

/* ---------------------------------------------------------------- choice */

/** The data file: ACCESS_CODES_FILE, else .data/access-codes.json in the app folder. */
export function codesFile(): string {
  return process.env.ACCESS_CODES_FILE || path.join(/*turbopackIgnore: true*/ process.cwd(), ".data", "access-codes.json");
}

let cached: { key: string; store: CodeStore } | undefined;

/** Upstash when both env vars are set, else the JSON file. */
export function getCodeStore(): CodeStore {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const key = url && token ? `upstash:${url}` : `file:${codesFile()}`;
  if (cached?.key !== key) cached = { key, store: url && token ? upstashCodeStore(url, token) : fileCodeStore(codesFile()) };
  return cached.store;
}

/** Which storage is in use, for the codes script's output. Never includes the URL. */
export function codeStoreKind(): "upstash" | "file" {
  return process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN ? "upstash" : "file";
}
