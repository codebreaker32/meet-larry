import "server-only";
import type { TasteItem } from "@/lib/types";
import { deviceHash, itemHash, personaFingerprint } from "./crypto";
import { getMeetKv } from "./kv";

// Blocks: permanent, both ways, everywhere (meet lists, meet chats and rooms). A person is known
// by an HMAC of their device id and of their picks, never by a name or the picks themselves.
// A block is stored under both people's keys, so it is found from either side, and the pick
// hashes catch the same person on a new phone with nearly the same picks.

export interface Identity {
  /** HMAC of the device id, when the phone sent one. */
  device?: string;
  /** HMAC of the whole pick set. */
  fp: string;
  /** HMAC of each pick id (at most 30), for a fuzzy match when picks change a little. */
  items: string[];
}

interface BlockEntry {
  a: Identity;
  b: Identity;
  at: number;
}

/** Entries kept per key; the oldest go first past this. */
const ENTRIES_PER_KEY = 200;
/** Same person on a new phone: this much of their picks the same, with at least MIN_ITEMS picks. */
const SIMILAR = 0.7;
const MIN_ITEMS = 4;

/** Who someone is, for blocks, from their device id (if any) and their picks. */
export function identityOf(deviceId: string | undefined, likes: Pick<TasteItem, "id">[]): Identity {
  const ids = likes.map((i) => i.id).slice(0, 30);
  return {
    ...(deviceId ? { device: deviceHash(deviceId) } : {}),
    fp: personaFingerprint(ids),
    items: [...new Set(ids.map(itemHash))],
  };
}

/** Same as identityOf, from a device hash that is already stored. */
export function identityFromHash(device: string | undefined, likes: Pick<TasteItem, "id">[]): Identity {
  const id = identityOf(undefined, likes);
  return device ? { ...id, device } : id;
}

function overlap(x: string[], y: string[]): number {
  if (x.length < MIN_ITEMS || y.length < MIN_ITEMS) return 0;
  const sy = new Set(y);
  const both = x.filter((h) => sy.has(h)).length;
  return both / new Set([...x, ...y]).size;
}

/** Whether two identities are the same person: same phone, same picks, or nearly the same picks. */
export function samePerson(x: Identity, y: Identity): boolean {
  if (x.device && y.device && x.device === y.device) return true;
  if (x.items.length && x.fp === y.fp) return true;
  return overlap(x.items, y.items) >= SIMILAR;
}

const keysOf = (id: Identity) => [...(id.device ? [`block:d:${id.device}`] : []), ...(id.items.length ? [`block:p:${id.fp}`] : [])];

async function entriesFor(id: Identity): Promise<BlockEntry[]> {
  const kv = getMeetKv();
  const lists = await Promise.all(keysOf(id).map((k) => kv.get<BlockEntry[]>(k)));
  return lists.flatMap((l) => l ?? []);
}

/** Saves a block of `blocked` by `blocker`. It hides each from the other, for good. */
export async function addBlock(blocker: Identity, blocked: Identity): Promise<void> {
  const kv = getMeetKv();
  const entry: BlockEntry = { a: blocker, b: blocked, at: Date.now() };
  const keys = [...new Set([...keysOf(blocker), ...keysOf(blocked)])];
  await Promise.all(keys.map((k) => kv.update<BlockEntry[]>(k, (cur) => [...(cur ?? []), entry].slice(-ENTRIES_PER_KEY))));
}

/** A check of many people against one viewer, reading the viewer's blocks once. */
export async function blockChecker(viewer: Identity): Promise<(other: Identity) => Promise<boolean>> {
  const mine = await entriesFor(viewer);
  const hit = (list: BlockEntry[], x: Identity, y: Identity) =>
    list.some((e) => (samePerson(e.a, x) && samePerson(e.b, y)) || (samePerson(e.a, y) && samePerson(e.b, x)));
  return async (other) => hit(mine, viewer, other) || hit(await entriesFor(other), viewer, other);
}

/** Whether either of the two has blocked the other. */
export async function isBlocked(x: Identity, y: Identity): Promise<boolean> {
  return (await blockChecker(x))(y);
}
