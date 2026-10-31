import "server-only";
import { type Repo, getRepo } from "@/lib/db";
import type { FriendView } from "@/lib/groups/shared";

// Friends come only from groups (D26): two people are friends while they share at least one group
// and neither has blocked the other. Nothing else makes a friend: no requests, search or follow.
// Unfriend = leave every shared group (src/lib/groups/service.ts), so the friendship is gone.

/** Everyone this uid shares a group with, minus blocks, by uid, with the shared group ids. */
export async function friendUids(uid: string, r: Repo = getRepo()): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const blocked = new Set(await r.blocks.involving(uid));
  for (const g of await r.groups.listFor(uid)) {
    for (const other of g.memberUids) {
      if (other === uid || blocked.has(other)) continue;
      out.set(other, [...(out.get(other) ?? []), g.id]);
    }
  }
  return out;
}

export async function areFriends(a: string, b: string, r: Repo = getRepo()): Promise<boolean> {
  if (a === b) return false;
  if (await r.blocks.between(a, b)) return false;
  return (await r.groups.listFor(a)).some((g) => g.memberUids.includes(b));
}

/** True when both people's "Show my check-ins to friends" switch is on (D1). */
export async function bothSharing(a: string, b: string, r: Repo = getRepo()): Promise<boolean> {
  const [x, y] = await Promise.all([r.accounts.get(a), r.accounts.get(b)]);
  return !!x?.sharingWithFriends && !!y?.sharingWithFriends;
}

/** GET /api/friends: names and usernames only, never a uid, phone or place. */
export async function listFriends(uid: string, r: Repo = getRepo()): Promise<FriendView[]> {
  const me = await r.accounts.get(uid);
  const out: FriendView[] = [];
  for (const [other, groupIds] of await friendUids(uid, r)) {
    const a = await r.accounts.get(other);
    if (!a) continue;
    out.push({ username: a.username, displayName: a.name, sharing: !!me?.sharingWithFriends && !!a.sharingWithFriends,
      groupIds,
      ...(a.isDemoFriend ? { isDemoFriend: true } : {}),
    });
  }
  return out.sort((x, y) => x.displayName.localeCompare(y.displayName));
}

/** A friend's uid from their username, or null when they are not this person's friend (no lookup of strangers). */
export async function friendByUsername(uid: string, username: string, r: Repo = getRepo()): Promise<string | null> {
  const other = await r.usernames.owner(username);
  if (!other || !(await areFriends(uid, other, r))) return null;
  return other;
}
