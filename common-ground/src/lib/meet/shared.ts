import "server-only";
import { findCommonGround } from "@/lib/qloo";
import { type Domain, DOMAIN_KEYS, type Profile, type TasteItem } from "@/lib/types";
import { MEET_MIN_SHARED_PICKS, MEET_SHARED_MAX, MEET_TTL_MS } from "./config";
import { pairKey } from "./crypto";
import { getMeetKv } from "./kv";

// What two people at a venue really share, worked out on the server from their personas.
// 1. Picks both made (the same Qloo entity): free, and shown at once.
// 2. Qloo bridges: things each person's taste points to on its own (findCommonGround). These cost
//    Qloo calls, so they run in the background, one pair at a time, under a small budget, and are
//    cached for the visit. Nobody is ever listed without one of the two.

export interface Shared {
  /** Picks both people made. */
  both: string[];
  /** Qloo bridges both tastes point to. */
  bridges: string[];
}

export interface MeetPerson {
  fp: string;
  likes: TasteItem[];
}

/** Picks both made, in the viewer's order (their newest or strongest first). */
export function sharedPicks(viewer: TasteItem[], other: TasteItem[]): string[] {
  const theirs = new Set(other.map((i) => i.id));
  const out: string[] = [];
  for (const i of viewer) if (theirs.has(i.id) && !out.includes(i.name)) out.push(i.name);
  return out.slice(0, MEET_SHARED_MAX);
}

/** The two domains both people picked most in (so Qloo is asked where both tastes are). */
export function pairDomains(a: TasteItem[], b: TasteItem[], n = 2): Domain[] {
  const count = (items: TasteItem[], d: Domain) => items.filter((i) => i.domain === d).length;
  return [...DOMAIN_KEYS]
    .map((d) => ({ d, score: Math.min(count(a, d), count(b, d)) * 10 + count(a, d) + count(b, d) }))
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, n)
    .map((x) => x.d);
}

const cacheKey = (a: MeetPerson, b: MeetPerson) => `bridge:${pairKey("bridge", ...[a.fp, b.fp].sort())}`;

/** Cached Qloo bridges for the pair, or undefined when not worked out yet. */
export async function cachedBridges(a: MeetPerson, b: MeetPerson): Promise<string[] | undefined> {
  const hit = await getMeetKv().get<{ names: string[] }>(cacheKey(a, b));
  return hit?.names;
}

/* ---------------------------------------------------------------- background Qloo work */

export type FindGround = (a: Profile, b: Profile, domains: Domain[]) => Promise<{ bridges: { name: string }[] }>;

interface Queue {
  pending: Map<string, () => Promise<void>>;
  running: boolean;
  /** Token bucket for Qloo calls made for meet lists (per server). */
  tokens: number;
  updated: number;
}
const g = globalThis as typeof globalThis & { __larryMeetQueue?: Queue };
const queue = (g.__larryMeetQueue ??= { pending: new Map(), running: false, tokens: 0, updated: 0 });

/** Qloo calls for meet lists, per server: a pair costs about 4, so this is a few pairs a minute. */
const QLOO_BURST = 16;
const QLOO_PER_SEC = 1 / 4;
const CALLS_PER_PAIR = 4;
const QUEUE_MAX = 50;

/** Takes the Qloo calls one pair needs, if the budget has them. */
function takeQloo(now = Date.now()): boolean {
  if (!queue.updated) queue.tokens = QLOO_BURST;
  queue.tokens = Math.min(QLOO_BURST, queue.tokens + Math.max(0, (now - queue.updated) / 1000) * QLOO_PER_SEC);
  queue.updated = now;
  if (queue.tokens < CALLS_PER_PAIR) return false;
  queue.tokens -= CALLS_PER_PAIR;
  return true;
}

async function drain() {
  if (queue.running) return;
  queue.running = true;
  try {
    while (queue.pending.size) {
      const [key, job] = queue.pending.entries().next().value as [string, () => Promise<void>];
      // Four Qloo calls per pair; wait for the budget instead of bursting into Qloo's 429s.
      if (!takeQloo()) return;
      queue.pending.delete(key);
      await job().catch((err: unknown) => console.error("Meet common ground failed:", err instanceof Error ? err.message : err));
    }
  } finally {
    queue.running = false;
  }
}

/**
 * Asks Qloo, in the background, what the pair's tastes both point to, unless it is cached or
 * already queued. Returns a promise that settles when the queue has run (for tests).
 */
// Qloo's own ranking only: Larry's curation is a model call nobody's access code would pay for.
const qlooBridges: FindGround = (a, b, domains) => findCommonGround(a, b, domains, { curate: false });

export function queueBridges(a: MeetPerson, b: MeetPerson, find: FindGround = qlooBridges): Promise<void> {
  const key = cacheKey(a, b);
  if (queue.pending.has(key) || queue.pending.size >= QUEUE_MAX) return drain();
  const domains = pairDomains(a.likes, b.likes);
  queue.pending.set(key, async () => {
    if (await getMeetKv().get(key)) return;
    let names: string[] = [];
    if (domains.length) {
      const ground = await find({ name: "A", items: a.likes.slice(0, 20) }, { name: "B", items: b.likes.slice(0, 20) }, domains);
      names = ground.bridges.map((x) => x.name).filter(Boolean).slice(0, 2);
    }
    // Cached even when empty, so a pair with nothing in common isn't asked about again this visit.
    await getMeetKv().update(key, () => ({ names }), MEET_TTL_MS);
  });
  return drain();
}

/** Clears the queue. For tests. */
export function resetSharedQueue() {
  queue.pending.clear();
  queue.running = false;
  queue.tokens = 0;
  queue.updated = 0;
}

/** "Spirited Away", "Spirited Away and cricket", "A, B and C". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** What one person is counted under in the list: one thing only, never their whole card. */
export interface Topic {
  kind: "pick" | "bridge";
  thing: string;
}

/**
 * The one thing a person is counted under, or null when they aren't listed at all. Picks both
 * chose count only from MEET_MIN_SHARED_PICKS up (one pick in common is easy to fish for);
 * otherwise a Qloo bridge, which nobody can fish for by copying one pick.
 */
export function topicFor(s: Shared): Topic | null {
  if (s.both.length >= MEET_MIN_SHARED_PICKS) return { kind: "pick", thing: s.both[0] };
  if (s.bridges.length) return { kind: "bridge", thing: s.bridges[0] };
  return null;
}

export const topicKey = (t: Topic) => `${t.kind}:${t.thing.toLowerCase()}`;

/** The easy-read line for a group: an anonymous count per shared thing, as PRODUCT.md asks. */
export function groupLine(t: Topic, count: number): string {
  if (t.kind === "pick") return count === 1 ? `Someone here likes ${t.thing} too.` : `${count} people here like ${t.thing} too.`;
  return count === 1 ? `Larry thinks you and someone here would both love ${t.thing}.` : `Larry thinks you and ${count} people here would all love ${t.thing}.`;
}
