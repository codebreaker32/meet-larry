import "server-only";
import { getRepo, repoKind } from "@/lib/db";
import type { RepoKv } from "@/lib/db";

// Storage for Open to meet: JSON documents with a time to live. Picked in this order:
//  1. Upstash Redis REST, when UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set (use a
//     database with eviction off, so blocks and reports are never dropped);
//  2. Firestore, through the app's Repo kv (kv/{sha256(key)}, server only, rules deny all clients),
//     whenever the app's database is Firestore (production, or dev with credentials);
//  3. memory (Vitest, Playwright, a dev server without credentials).
// Production refuses Open to meet without durable storage and a fixed MEET_SECRET (http.ts
// assertMeetStorage), because blocks must last for good. Nothing is kept past its TTL, and no
// location history is ever written: a venue's document holds only who is open there now.

export interface MeetKv {
  get<T>(key: string): Promise<T | null>;
  /**
   * Read-modify-write. `change` gets a copy (or null when there is none) and returns the new
   * value, or null to leave it alone; `undefined` deletes it. It may run more than once on a
   * concurrent write, so keep it pure. ttlMs: how long the written value lives (none = forever).
   */
  update<T>(key: string, change: (cur: T | null) => T | null | undefined, ttlMs?: number): Promise<T | null>;
  del(key: string): Promise<void>;
}

export class MeetStoreError extends Error {}

interface Envelope<T> {
  rev: number;
  v: T;
}

/* ---------------------------------------------------------------- in memory */

interface MemoryEntry {
  json: string;
  expiresAt: number;
}

const MAX_MEMORY_KEYS = 50_000;
const g = globalThis as typeof globalThis & { __larryMeetKv?: Map<string, MemoryEntry> };
const memoryMap = () => (g.__larryMeetKv ??= new Map());

/** Empties the in-memory store. For tests. */
export function resetMeetMemory() {
  memoryMap().clear();
}

/** Safety records: never evicted to make room (blocks are for good, reports wait for review). */
export const isDurableKey = (key: string) => key.startsWith("block:") || key.startsWith("report:");

function sweep(map: Map<string, MemoryEntry>, now: number) {
  if (map.size < MAX_MEMORY_KEYS) return;
  for (const [k, e] of map) if (e.expiresAt <= now) map.delete(k);
  // Still too many: drop the short-lived ones that expire first. Blocks and reports always stay.
  if (map.size >= MAX_MEMORY_KEYS) {
    const sorted = [...map.entries()].filter(([k]) => !isDurableKey(k)).sort((x, y) => x[1].expiresAt - y[1].expiresAt);
    for (const [k] of sorted.slice(0, map.size - MAX_MEMORY_KEYS + 1)) map.delete(k);
  }
}

export const memoryKv: MeetKv = {
  async get<T>(key: string) {
    const map = memoryMap();
    const e = map.get(key);
    if (!e) return null;
    if (e.expiresAt <= Date.now()) {
      map.delete(key);
      return null;
    }
    return JSON.parse(e.json) as T;
  },
  async update<T>(key: string, change: (cur: T | null) => T | null | undefined, ttlMs?: number) {
    const map = memoryMap();
    const now = Date.now();
    const e = map.get(key);
    const cur = e && e.expiresAt > now ? (JSON.parse(e.json) as T) : null;
    const next = change(cur === null ? null : (JSON.parse(e!.json) as T));
    if (next === null) return cur;
    if (next === undefined) {
      map.delete(key);
      return null;
    }
    sweep(map, now);
    map.set(key, { json: JSON.stringify(next), expiresAt: ttlMs === undefined ? Infinity : now + ttlMs });
    return next;
  },
  async del(key) {
    memoryMap().delete(key);
  },
};

/* ---------------------------------------------------------------- Upstash Redis (REST) */

const PREFIX = "larry:meet:";
const TIMEOUT_MS = 5_000;
const CAS_TRIES = 8;

// Writes only if nobody wrote since we read (same rev); -1 when it was there and is gone now.
// ARGV: expected rev (0 = must not exist), new json, ttl ms (0 = none).
const CAS = `local cur = redis.call('GET', KEYS[1])
local want = tonumber(ARGV[1])
if want == 0 then
  if cur then return 0 end
else
  if not cur then return -1 end
  if cjson.decode(cur).rev ~= want then return 0 end
end
if tonumber(ARGV[3]) > 0 then redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3]) else redis.call('SET', KEYS[1], ARGV[2]) end
return 1`;

export function upstashKv(url: string, token: string): MeetKv {
  const base = url.replace(/\/+$/, "");
  async function command<T>(args: (string | number)[]): Promise<T> {
    let res: Response;
    try {
      res = await fetch(base, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(args.map(String)),
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      // Never log the URL or token.
      throw new MeetStoreError(`Meet storage unreachable (${(err as Error).name})`);
    }
    const body = (await res.json().catch(() => null)) as { result?: T; error?: string } | null;
    if (!res.ok || !body || body.error) throw new MeetStoreError(`Meet storage error (${res.status})`);
    return body.result as T;
  }
  const read = async <T>(key: string) => {
    const raw = await command<string | null>(["GET", PREFIX + key]);
    return raw ? (JSON.parse(raw) as Envelope<T>) : null;
  };
  return {
    async get<T>(key: string) {
      return (await read<T>(key))?.v ?? null;
    },
    async update<T>(key: string, change: (cur: T | null) => T | null | undefined, ttlMs?: number) {
      for (let i = 0; i < CAS_TRIES; i++) {
        const cur = await read<T>(key);
        const next = change(cur ? structuredClone(cur.v) : null);
        if (next === null) return cur?.v ?? null;
        if (next === undefined) {
          if (cur) await command(["DEL", PREFIX + key]);
          return null;
        }
        const env: Envelope<T> = { rev: (cur?.rev ?? 0) + 1, v: next };
        const r = await command<number>(["EVAL", CAS, 1, PREFIX + key, cur?.rev ?? 0, JSON.stringify(env), ttlMs ?? 0]);
        if (r === 1) return next;
        await new Promise((resolve) => setTimeout(resolve, 20 + Math.random() * 60 * (i + 1)));
      }
      throw new MeetStoreError("Meet storage busy");
    },
    async del(key) {
      await command(["DEL", PREFIX + key]);
    },
  };
}

/* ---------------------------------------------------------------- Firestore (the app's Repo kv) */

const FS_PREFIX = "meet:";

/**
 * Open to meet on Firestore: the Repo's kv (a transaction per update, TTL field for cleanup), under
 * its own "meet:" prefix. Errors thrown by `change` (a MeetError such as "picks fixed") pass through
 * as they are; anything Firestore throws becomes a MeetStoreError (logged without keys or data).
 */
export function firestoreMeetKv(base: () => RepoKv): MeetKv {
  const wrap = async <T>(run: (kv: RepoKv) => Promise<T>, fromChange: { err?: unknown }): Promise<T> => {
    try {
      return await run(base());
    } catch (err) {
      if (fromChange.err !== undefined && err === fromChange.err) throw err;
      throw new MeetStoreError(`Meet storage error (${err instanceof Error ? err.name : "unknown"})`);
    }
  };
  return {
    get<T>(key: string) {
      return wrap((kv) => kv.get<T>(FS_PREFIX + key), {});
    },
    update<T>(key: string, change: (cur: T | null) => T | null | undefined, ttlMs?: number) {
      const box: { err?: unknown } = {};
      const guarded = (cur: T | null) => {
        try {
          return change(cur);
        } catch (err) {
          box.err = err;
          throw err;
        }
      };
      return wrap((kv) => kv.update<T>(FS_PREFIX + key, guarded, ttlMs), box);
    },
    del(key: string) {
      return wrap((kv) => kv.del(FS_PREFIX + key), {});
    },
  };
}

const fsMeetKv = firestoreMeetKv(() => getRepo().kv);

/** Where Open to meet keeps its documents right now. */
export type MeetStoreKind = "upstash" | "firestore" | "memory";

export function meetStoreKind(): MeetStoreKind {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) return "upstash";
  // getRepo() itself falls back to memory in development without credentials; that is still fine.
  if (repoKind() === "firestore") return "firestore";
  return "memory";
}

let upstash: { url: string; kv: MeetKv } | undefined;

/** Upstash when both env vars are set, else Firestore when the app's database is Firestore, else memory. */
export function getMeetKv(): MeetKv {
  const kind = meetStoreKind();
  if (kind === "memory") return memoryKv;
  if (kind === "firestore") return fsMeetKv;
  const url = process.env.UPSTASH_REDIS_REST_URL!;
  if (upstash?.url !== url) upstash = { url, kv: upstashKv(url, process.env.UPSTASH_REDIS_REST_TOKEN!) };
  return upstash.kv;
}
