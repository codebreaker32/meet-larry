// The viewer model (component-specs C2, A4). The server types a profile by viewer before it leaves
// the server, so the UI can't leak what it is never passed: StrangerProfile has no venue at all.
import type { FriendTitle, PublicTitle, Stage } from "./titles";

export type Viewer = "owner" | "friend" | "stranger";

/** A place, by its Qloo id and name. */
export interface VenueRef {
  placeId: string;
  placeName: string;
}

/** What anyone may see: "Final Boss at 2 places". No venues, places, times or Glory. */
export interface PublicTitleCount {
  title: PublicTitle;
  places: number;
}

export interface StrangerProfile {
  viewer: "stranger";
  username: string;
  publicTitles: PublicTitleCount[];
}

/**
 * A mutual, accepted friend. Venues, Glory and friend titles show only when BOTH people's sharing
 * switch is on (D1); otherwise `sharing` is false, the lists are empty and there is no Glory.
 */
export interface FriendProfile {
  viewer: "friend";
  username: string;
  /** Friends know each other's name. */
  displayName: string;
  glory?: number;
  publicTitles: { title: PublicTitle; venue: VenueRef }[];
  friendTitles: { title: FriendTitle; venue: VenueRef }[];
  /** Duo count: only the two of you see it. 0 until co-presence lands (D15). */
  timesMet: number;
  sharing: boolean;
}

export interface OwnerPlace {
  venue: VenueRef;
  stage: Stage;
  visits: number;
  /** Distinct weeks with a verified visit (Spot count). */
  weeks: number;
  nextStage?: { stage: Stage; visitsAway: number };
}

export interface OwnerProfile {
  viewer: "owner";
  username: string;
  displayName: string;
  glory: number;
  places: OwnerPlace[];
  /** alias = that place's anonymous podium name, shown only to the owner. */
  publicTitles: { title: PublicTitle; venue: VenueRef; alias: string }[];
  friendTitles: { title: FriendTitle; venue: VenueRef }[];
  /** Off by default. */
  sharingWithFriends: boolean;
  /** D12 "Show me on place leaderboards": off by default. */
  showOnLeaderboards: boolean;
  /** D14: one owner-only line, e.g. "1 visit until you take Party Leader at Café Condi". Never "you lost". */
  rivalry?: string;
}

export type ProfileData = StrangerProfile | FriendProfile | OwnerProfile;
