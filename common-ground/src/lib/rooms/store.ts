import "server-only";
import type { Identity } from "@/lib/meet/blocks";
import type { Room } from "../contracts";
import type { Mood } from "../types/signals";

// Room storage. In memory by default (one server, survives dev hot reloads); Upstash Redis
// over its REST API when UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set, so
// several serverless instances share the same rooms. Rooms expire 6 hours after the last write.

export const ROOM_TTL_MS = 6 * 60 * 60 * 1000;

/** A room as stored: the public Room plus fields that never leave the server. */
export interface StoredRoom extends Room {
  /** memberId -> SHA-256 of that member's join token. Tokens themselves are never stored. */
  tokenHashes: Record<string, string>;
  /** memberId -> name, kept after a member leaves so Larry still reads old messages right. */
  names: Record<string, string>;
  /** Bumps on every write, presence included. Used for compare-and-set; not shown. */
  rev: number;
  updatedAt: number;
  /** Who holds the Larry lock and since when, so a crashed run can't lock the room forever. */
  larryLock?: { id: string; since: number };
  /** Members and picks the stored ground was computed for. */
  groundKey?: string;
  /** memberId -> HMAC of that phone's device id, when it sent one (for Block). Never shown. */
  devices?: Record<string, string>;
  /** Set when the room was opened by a mutual wave in Open to meet. */
  meet?: StoredMeetInfo;
  /**
   * memberId -> who someone was after they left (HMACs of their phone and picks, never the picks),
   * so Block and Report still work on them once they are gone. Never shown.
   */
  departed?: Record<string, Identity>;
  /**
   * memberId -> that member's own mood and Hidden Gems switch, sent with their own requests. Server
   * only: never in toPublic, never in meet rooms, gone when they leave. Larry reads moods only as a
   * counts-only blend (agent.ts moodBlend). Age is never stored in a room.
   */
  signals?: Record<string, RoomSignals>;
}

/** What a room keeps of a member's signals: mood and Hidden Gems, never age. */
export interface RoomSignals {
  mood?: Mood;
  hiddenGems?: boolean;
}

/** A meet room: two people who both waved at a venue, and Larry. */
export interface StoredMeetInfo {
  /** The venue's name from Qloo (never typed by a person). The only place Larry suggests meeting. */
  venueName: string;
  /** What Larry found they share, as easy-read names. */
  shared: string[];
  /** Red flag kind -> when Larry last stepped in for it, so it doesn't nag. */
  flagsAt: Record<string, number>;
}

/** What members' phones see of a meet room (only members, so only after a mutual wave). */
export interface PublicMeetInfo {
  venueName: string;
  shared: string[];
  /** People who left (id and first name only), so Block and Report stay one tap away. */
  left?: { id: string; name: string }[];
}

export interface RoomStore {
  get(code: string): Promise<StoredRoom | null>;
  /** Saves a new room. False when the code is already taken. */
  create(room: StoredRoom): Promise<boolean>;
  /**
   * Read-modify-write of one room. `change` gets a copy and returns the new room, or null to
   * leave it as it is; it may run more than once (on a concurrent write), so keep it pure.
   * Errors it throws reach the caller. Returns the room after the write, or null if there is none.
   */
  update(code: string, change: (room: StoredRoom) => StoredRoom | null): Promise<StoredRoom | null>;
  delete(code: string): Promise<void>;
}

/* ---------------------------------------------------------------- in memory */

interface MemoryEntry {
  json: string;
  expiresAt: number;
}

const MAX_MEMORY_ROOMS = 5_000;

// On globalThis so `next dev` hot reloads don't empty it.
const g = globalThis as typeof globalThis & { __larryRooms?: Map<string, MemoryEntry> };

function memoryMap(): Map<string, MemoryEntry> {
  return (g.__larryRooms ??= new Map());
}

/** Empties the in-memory store. For tests. */
export function resetMemoryStore() {
  memoryMap().clear();
}

function sweep(map: Map<string, MemoryEntry>, now: number) {
  for (const [code, e] of map) if (e.expiresAt <= now) map.delete(code);
  // Still too many: drop the ones that would expire first.
  if (map.size >= MAX_MEMORY_ROOMS) {
    const oldest = [...map.entries()].sort((x, y) => x[1].expiresAt - y[1].expiresAt);
    for (const [code] of oldest.slice(0, map.size - MAX_MEMORY_ROOMS + 1)) map.delete(code);
  }
}

// JSON strings, not objects, so a caller can never change a stored room by accident and the
// behaviour matches Redis. Each method reads and writes in one tick, so it is atomic here.
export const memoryStore: RoomStore = {
  async get(code) {
    const map = memoryMap();
    const e = map.get(code);
    if (!e) return null;
    if (e.expiresAt <= Date.now()) {
      map.delete(code);
      return null;
    }
    return JSON.parse(e.json) as StoredRoom;
  },
  async create(room) {
    const map = memoryMap();
    const now = Date.now();
    sweep(map, now);
    const e = map.get(room.code);
    if (e && e.expiresAt > now) return false;
    map.set(room.code, { json: JSON.stringify(room), expiresAt: now + ROOM_TTL_MS });
    return true;
  },
  async update(code, change) {
    const map = memoryMap();
    const now = Date.now();
    const e = map.get(code);
    if (!e || e.expiresAt <= now) {
      map.delete(code);
      return null;
    }
    const cur = JSON.parse(e.json) as StoredRoom;
    const next = change(JSON.parse(e.json) as StoredRoom);
    if (!next) return cur;
    const saved: StoredRoom = { ...next, rev: cur.rev + 1, updatedAt: now };
    map.set(code, { json: JSON.stringify(saved), expiresAt: now + ROOM_TTL_MS });
    return saved;
  },
  async delete(code) {
    memoryMap().delete(code);
  },
};

/* ---------------------------------------------------------------- Upstash Redis (REST) */

const KEY_PREFIX = "larry:room:";
const UPSTASH_TIMEOUT_MS = 5_000;
const CAS_TRIES = 8;

// Writes the room only if nobody else wrote it since we read it (same rev). cjson is built in.
const CAS_SCRIPT = `local cur = redis.call('GET', KEYS[1])
if not cur then return -1 end
if cjson.decode(cur).rev ~= tonumber(ARGV[1]) then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
return 1`;

export class RoomStoreError extends Error {}

export function upstashStore(url: string, token: string): RoomStore {
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
      // Never log the URL or token.
      throw new RoomStoreError(`Room storage unreachable (${(err as Error).name})`);
    }
    const body = (await res.json().catch(() => null)) as { result?: T; error?: string } | null;
    if (!res.ok || !body || body.error) {
      throw new RoomStoreError(`Room storage error (${res.status}${body?.error ? `: ${String(body.error).slice(0, 80)}` : ""})`);
    }
    return body.result as T;
  }

  const key = (code: string) => KEY_PREFIX + code;
  const parse = (raw: string | null) => (raw ? (JSON.parse(raw) as StoredRoom) : null);

  return {
    async get(code) {
      return parse(await command<string | null>(["GET", key(code)]));
    },
    async create(room) {
      const ok = await command<string | null>(["SET", key(room.code), JSON.stringify(room), "NX", "PX", ROOM_TTL_MS]);
      return ok === "OK";
    },
    async update(code, change) {
      for (let i = 0; i < CAS_TRIES; i++) {
        const cur = parse(await command<string | null>(["GET", key(code)]));
        if (!cur) return null;
        const next = change(structuredClone(cur));
        if (!next) return cur;
        const saved: StoredRoom = { ...next, rev: cur.rev + 1, updatedAt: Date.now() };
        const r = await command<number>(["EVAL", CAS_SCRIPT, 1, key(code), cur.rev, JSON.stringify(saved), ROOM_TTL_MS]);
        if (r === 1) return saved;
        if (r === -1) return null;
        // Someone else wrote first: read again and retry, with a little jitter.
        await new Promise((resolve) => setTimeout(resolve, 20 + Math.random() * 60 * (i + 1)));
      }
      throw new RoomStoreError("Room storage busy: too many writes at once");
    },
    async delete(code) {
      await command<number>(["DEL", key(code)]);
    },
  };
}

/* ---------------------------------------------------------------- choice */

let upstash: { url: string; store: RoomStore } | undefined;

/** Upstash when both env vars are set, else the in-memory store. */
export function getRoomStore(): RoomStore {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return memoryStore;
  if (upstash?.url !== url) upstash = { url, store: upstashStore(url, token) };
  return upstash.store;
}
