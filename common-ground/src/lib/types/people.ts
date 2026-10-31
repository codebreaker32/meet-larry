// Podium, friends and friend titles. A podium alias is a one-way function of a secret key the device
// holds (src/lib/alias.ts), so knowing someone's public alias never lets anyone move their count.
import type { FriendTitle, PublicTitle } from "./titles";

export interface PodiumEntry {
  rank: 1 | 2 | 3;
  title: PublicTitle;
  /** aliasName(podiumId): a different anonymous name at every place. */
  alias: string;
}

/**
 * GET /api/podium/[placeId]: no auth and no `mine`. The device finds its own alias in this public
 * list, so a podium read never ties a session to a podium key.
 */
export interface PodiumResponse {
  placeId: string;
  /** False until at least PODIUM_MIN_PARTICIPANTS people count here (D2); then entries is empty. */
  open: boolean;
  participants: number;
  entries: PodiumEntry[];
}

/** POST /api/podium/[placeId] (18+ bearer): moves the count from sha256(oldKey) to sha256(newKey). Secret keys, not names. */
export interface PodiumRerollRequest {
  oldKey: string;
  newKey: string;
}

/**
 * DELETE /api/podium/mine (bearer): removes the entries for these secret keys ("Leave podiums", and
 * the first step of account deletion). Each key comes with its place, because entries are stored
 * per place; the server derives sha256(key) and never stores the pairing.
 */
export interface PodiumMineRequest {
  keys: { placeId: string; key: string }[];
}

/** POST /api/friends {action: "invite"}: a 128-bit random code, single use, expires after 24 hours. */
export interface FriendInvite {
  code: string;
  /** ms */
  expiresAt: number;
}

export interface Friend {
  uid: string;
  username: string;
  displayName: string;
  /** True only when both people's sharing switch is on (D1). */
  sharing: boolean;
}

export interface FriendTitleAt {
  title: FriendTitle;
  placeId: string;
  placeName: string;
  uid: string;
}

/** GET /api/friends */
export interface FriendsResponse {
  friends: Friend[];
}

/** POST /api/friends bodies. PUT takes {sharing}; DELETE takes {uid} (also used on block). */
export type FriendsPostRequest = { action: "invite" } | { action: "accept"; code: string };
export interface FriendsPutRequest {
  sharing: boolean;
}
export interface FriendsDeleteRequest {
  uid: string;
}

export const FRIEND_INVITE_TTL_MS = 24 * 3600e3;
/** Invite codes carry 128 random bits (base64url, 22 characters). */
export const FRIEND_INVITE_BYTES = 16;
