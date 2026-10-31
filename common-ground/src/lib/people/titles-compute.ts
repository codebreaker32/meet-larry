import "server-only";
import { type Repo, getRepo } from "@/lib/db";
import type { VenueRef } from "@/lib/types/profile";
import { FRIEND_RANK_TITLES, type FriendTitle } from "@/lib/types/titles";
import { friendUids } from "./friends";

// Friend titles (Party Leader, Squad Captain, Crew Leader): ranks at a place among a person and the
// friends who share with them (both switches on, D1), from their synced visit counts. Friends = group
// members (D26). Host needs co-presence and is STRETCH. Pure ranking below; I/O only in circleOf.

export interface CircleCounts {
  uid: string;
  name: string;
  places: { placeId: string; placeName: string; visits: number }[];
}

export interface FriendTitleHeld {
  uid: string;
  title: FriendTitle;
  venue: VenueRef;
}

/** At least this many people in the circle must have visited a place for it to have friend titles. */
export const FRIEND_TITLE_MIN = 2;

/** Dense ranks 1-3 per place, ties share a title. Pure. */
export function friendTitles(circle: CircleCounts[]): FriendTitleHeld[] {
  const byPlace = new Map<string, { venue: VenueRef; rows: { uid: string; visits: number }[] }>();
  for (const p of circle)
    for (const c of p.places) {
      if (!(c.visits > 0)) continue;
      const e = byPlace.get(c.placeId) ?? { venue: { placeId: c.placeId, placeName: c.placeName }, rows: [] };
      e.rows.push({ uid: p.uid, visits: c.visits });
      byPlace.set(c.placeId, e);
    }
  const out: FriendTitleHeld[] = [];
  for (const { venue, rows } of byPlace.values()) {
    if (rows.length < FRIEND_TITLE_MIN) continue;
    rows.sort((a, b) => b.visits - a.visits);
    let rank = 0;
    let last = -1;
    for (const row of rows) {
      if (row.visits !== last) {
        rank += 1;
        last = row.visits;
      }
      if (rank > 3) break;
      out.push({ uid: row.uid, title: FRIEND_RANK_TITLES[rank - 1], venue });
    }
  }
  return out;
}

/**
 * D14: at most one owner-only line, the closest friend title within reach, e.g. "1 visit until you
 * take Party Leader at Café Condi". Never "you lost", never a friend's count. Pure.
 */
export function rivalryLine(ownerUid: string, circle: CircleCounts[], maxAway = 2): string | undefined {
  const me = circle.find((p) => p.uid === ownerUid);
  if (!me) return undefined;
  let best: { away: number; title: FriendTitle; place: string } | undefined;
  for (const mine of me.places) {
    const others = circle
      .filter((p) => p.uid !== ownerUid)
      .map((p) => p.places.find((c) => c.placeId === mine.placeId)?.visits ?? 0)
      .filter((v) => v > 0);
    if (!others.length) continue;
    // Distinct visit counts above mine, highest first: the next title up is one rank better.
    const above = [...new Set(others.filter((v) => v > mine.visits))].sort((a, b) => b - a);
    if (!above.length) continue;
    const target = above[above.length - 1];
    const rankAfter = above.length; // passing `target` puts me at this dense rank
    if (rankAfter > 3) continue;
    const away = target - mine.visits + 1;
    if (away > maxAway) continue;
    const title = FRIEND_RANK_TITLES[rankAfter - 1];
    if (!best || away < best.away) best = { away, title, place: mine.placeName };
  }
  if (!best) return undefined;
  const word = { "party-leader": "Party Leader", "squad-captain": "Squad Captain", "crew-leader": "Crew Leader", host: "Host" }[best.title];
  return `${best.away} visit${best.away === 1 ? "" : "s"} until you take ${word} at ${best.place}`;
}

/** This person plus the friends who share with them (both switches on), with their synced counts. */
export async function circleOf(uid: string, r: Repo = getRepo()): Promise<CircleCounts[]> {
  const me = await r.accounts.get(uid);
  if (!me) return [];
  const load = async (u: string, name: string): Promise<CircleCounts> => ({
    uid: u,
    name,
    places: ((await r.sync.get(u))?.placeCounters ?? []).map((c) => ({ placeId: c.placeId, placeName: c.placeName, visits: c.visits })),
  });
  const out = [await load(uid, me.name)];
  if (!me.sharingWithFriends) return out;
  for (const other of (await friendUids(uid, r)).keys()) {
    const a = await r.accounts.get(other);
    if (a?.sharingWithFriends) out.push(await load(other, a.name));
  }
  return out;
}
