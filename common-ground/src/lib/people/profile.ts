import "server-only";
import { type Repo, getRepo } from "@/lib/db";
import type { FriendProfile, OwnerProfile, ProfileData, StrangerProfile } from "@/lib/types/profile";
import { PUBLIC_TITLES, STAGE_VISITS, STAGES, type Stage } from "@/lib/types/titles";
import { areFriends, bothSharing } from "./friends";
import { circleOf, friendTitles, rivalryLine } from "./titles-compute";

// A profile typed by viewer ON THE SERVER (component-specs C2): strangers get public title counts
// only (no venue, place, time or Glory); friends (they share a group) see venues, Glory and friend
// titles only when both share; the owner sees everything. Blocked or unknown: null (the route says 404).

function stageOf(visits: number): Stage {
  let s: Stage = "rookie";
  for (const st of STAGES) if (visits >= STAGE_VISITS[st]) s = st;
  return s;
}

function nextStageOf(visits: number): { stage: Stage; visitsAway: number } | undefined {
  const st = STAGES.find((x) => STAGE_VISITS[x] > visits);
  return st ? { stage: st, visitsAway: STAGE_VISITS[st] - visits } : undefined;
}

export async function profileFor(viewerUid: string | null, username: string, r: Repo = getRepo()): Promise<ProfileData | null> {
  const uid = await r.usernames.owner(username);
  if (!uid) return null;
  const a = await r.accounts.get(uid);
  // Demo friends are made-up accounts that live only in the demo account's groups: no profile page.
  if (!a || a.isDemoFriend) return null;
  if (viewerUid && viewerUid !== uid && (await r.blocks.between(viewerUid, uid))) return null;

  if (viewerUid === uid) {
    const sync = await r.sync.get(uid);
    const record = await r.profiles.get(uid);
    const circle = await circleOf(uid, r);
    const owner: OwnerProfile = {
      viewer: "owner",
      username: a.username,
      displayName: a.name,
      glory: a.glory,
      places: (sync?.placeCounters ?? [])
        .filter((c) => c.visits > 0)
        .map((c) => {
          const next = nextStageOf(c.visits);
          return { venue: { placeId: c.placeId, placeName: c.placeName }, stage: c.stage ?? stageOf(c.visits), visits: c.visits, weeks: c.spotWeeks, ...(next ? { nextStage: next } : {}) };
        }),
      // The per-place alias is known only to the device (it holds the secret key); it fills it in.
      publicTitles: a.showOnLeaderboards ? (record?.publicTitles ?? []).map((t) => ({ ...t, alias: "" })) : [],
      friendTitles: friendTitles(circle)
        .filter((t) => t.uid === uid)
        .map(({ title, venue }) => ({ title, venue })),
      sharingWithFriends: a.sharingWithFriends,
      showOnLeaderboards: a.showOnLeaderboards,
    };
    const rivalry = rivalryLine(uid, circle);
    if (rivalry) owner.rivalry = rivalry;
    return owner;
  }

  if (viewerUid && (await areFriends(viewerUid, uid, r))) {
    const sharing = await bothSharing(viewerUid, uid, r);
    const friend: FriendProfile = {
      viewer: "friend",
      username: a.username,
      displayName: a.name,
      publicTitles: [],
      friendTitles: [],
      timesMet: 0,
      sharing,
    };
    if (sharing) {
      friend.glory = a.glory;
      friend.publicTitles = a.showOnLeaderboards ? ((await r.profiles.get(uid))?.publicTitles ?? []) : [];
      friend.friendTitles = friendTitles(await circleOf(viewerUid, r))
        .filter((t) => t.uid === uid)
        .map(({ title, venue }) => ({ title, venue }));
    }
    return friend;
  }

  const stranger: StrangerProfile = {
    viewer: "stranger",
    username: a.username,
    // Counts only, and only for someone who chose to be on leaderboards.
    publicTitles: a.showOnLeaderboards
      ? PUBLIC_TITLES.map((title) => ({ title, places: a.publicTitleCounts?.[title] ?? 0 })).filter((t) => t.places > 0)
      : [],
  };
  return stranger;
}
