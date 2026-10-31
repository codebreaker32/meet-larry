import "server-only";
import { createHash } from "node:crypto";
import { aliasName } from "@/lib/alias";
import { type Repo, getRepo } from "@/lib/db";
import type { Session } from "@/lib/types/account";
import type { PodiumEntry, PodiumResponse } from "@/lib/types/people";
import { PUBLIC_TITLES } from "@/lib/types/titles";

// Place podiums (D2, D12). Stored: podium/{placeId}/entries/{sha256(podiumKey)} = { visits }, never
// a uid. The display name is aliasName(podiumId), different at every place. The device holds the
// secret key, so only it can add to, move or remove its count. Visit numbers are never returned.

/** D2: the podium shows only with this many people counted at the place (3 for the hackathon). */
export const PODIUM_MIN_PARTICIPANTS = Math.max(1, Number(process.env.PODIUM_MIN_PARTICIPANTS) || 3);
/** D12: nobody is on a podium unless they switch "Show me on place leaderboards" on. */
export const PODIUM_DEFAULT_OPT_IN = false;
/** Rows read to work out the top 3 ranks with ties. */
const TOP_ROWS = 12;

/** What the server stores for a secret podium key: SHA-256 of its hex text (same as alias.ts podiumIdFor). */
export const podiumIdOf = (key: string) => createHash("sha256").update(key).digest("hex");

/**
 * GET /api/podium/[placeId]: public. Dense ranks 1 to 3 with ties ("two Final Bosses" is fine), the
 * per-place alias only, no visit counts, and nothing at all below the minimum.
 */
export async function readPodium(placeId: string, r: Repo = getRepo()): Promise<PodiumResponse> {
  const participants = await r.podium.participants(placeId);
  if (participants < PODIUM_MIN_PARTICIPANTS) return { placeId, open: false, participants, entries: [] };
  const rows = await r.podium.top(placeId, TOP_ROWS);
  const entries: PodiumEntry[] = [];
  let rank = 0;
  let last = -1;
  for (const row of rows) {
    if (row.visits <= 0) continue;
    if (row.visits !== last) {
      rank += 1;
      last = row.visits;
    }
    if (rank > 3) break;
    entries.push({ rank: rank as 1 | 2 | 3, title: PUBLIC_TITLES[rank - 1], alias: aliasName(row.podiumId) });
  }
  return { placeId, open: true, participants, entries };
}

/**
 * The verified-leave hook: one visit on the podium, only for an 18+ account with "Show me on place
 * leaderboards" switched on, and only with the device's secret key. The key is never logged or stored.
 */
export async function addPodiumVisit(session: Session | null, placeId: string, podiumKey: string | undefined, r: Repo = getRepo()): Promise<boolean> {
  if (!session?.isAdult || !podiumKey || !/^[0-9a-f]{64}$/.test(podiumKey)) return false;
  const account = await r.accounts.get(session.uid);
  if (!account?.showOnLeaderboards) return false;
  await r.podium.add(placeId, podiumIdOf(podiumKey), 1);
  return true;
}

/** Re-roll: moves the count from the old secret key to the new one. A public alias alone can't do this. */
export async function rerollPodium(placeId: string, oldKey: string, newKey: string, r: Repo = getRepo()): Promise<boolean> {
  return r.podium.move(placeId, podiumIdOf(oldKey), podiumIdOf(newKey));
}

/** "Leave podiums" and account deletion: removes the entries for these secret keys. */
export async function removeMine(keys: { placeId: string; key: string }[], r: Repo = getRepo()): Promise<void> {
  await r.podium.remove(keys.map((k) => ({ placeId: k.placeId, podiumId: podiumIdOf(k.key) })));
}
