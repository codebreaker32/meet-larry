// Groups (D25, D26): the only chats. Made by QR, 2 to 5 people including the creator (2 = one-to-one).
// Joining by QR is the consent, and group members are friends. Client-safe: no server imports, so the
// UI (2C) and the API share these shapes and words.
import type { GroupGround, PlanTicket } from "../contracts";
import type { Place } from "../types";

/** The UI word for a group. The user hasn't picked a name yet, so it lives in one constant. */
export const GROUP_WORD = "Group";

/** People in a group, including the creator. 2 is a one-to-one chat. */
export const GROUP_SIZES = [2, 3, 4, 5] as const;
export type GroupSize = (typeof GROUP_SIZES)[number];

/** A group QR stops working after this long, or as soon as the group is full. */
export const GROUP_QR_TTL_MS = 15 * 60 * 1000;
/** Messages are kept this long, then deleted. */
export const GROUP_MESSAGE_TTL_MS = 30 * 24 * 3600 * 1000;
/** Larry's opening message stays under this many words. */
export const OPENING_WORDS_MAX = 90;
/** Messages a poll returns at most (the newest). */
export const GROUP_MESSAGES_PAGE = 100;
/** Groups one person can be in at once. */
export const GROUPS_PER_PERSON_MAX = 30;

/**
 * Where a group QR points. The join token sits in the URL fragment, which browsers never send to a
 * server, so it can't end up in a log, a Referer header or analytics. The /scan page reads it and POSTs it.
 */
export const groupJoinPath = (token: string) => `/scan#t=${token}`;

/** Reads the token back from a /scan URL's fragment ("#t=..."), or null. */
export function joinTokenFromHash(hash: string): string | null {
  const m = /(?:^#?|&)t=([A-Za-z0-9_.-]{20,400})(?:&|$)/.exec(hash);
  return m ? m[1] : null;
}

/** A member as the other members see them: their name, picks colour and per-group id. Never a uid or phone. */
export interface GroupMemberView {
  /** Per-group id (random). Use it for remove, block and report. */
  id: string;
  name: string;
  username: string;
  /** Seat colour token, e.g. "var(--seat-1)". */
  color: string;
  /** Picks on their taste card, so the chat can show "Why this?" chips. */
  items: { id: string; name: string; domain: string }[];
  isCreator: boolean;
  isMe: boolean;
  /** A made-up demo friend of the demo account: always shown with DEMO_FRIEND_LABEL. */
  isDemoFriend?: boolean;
}

/** Said beside a demo friend's name in every member list and chat. */
export const DEMO_FRIEND_LABEL = "Demo friend";

export type GroupMessageKind =
  /** Larry's first message when the group forms: common ground plus one opener. */
  | "opening"
  /** Larry's answer to a tag (@Larry or a /command). */
  | "larry"
  /** Larry stepping in after a safety flag or a crisis line. */
  | "care"
  /** A quiet system line ("Sam joined", "Priya left"). */
  | "system"
  | "person";

export interface GroupMessageView {
  id: string;
  /** A member id, "larry", or "system". */
  from: string;
  /** Kept for a member who has left, so their old lines still have a name. */
  name?: string;
  text: string;
  at: number;
  kind: GroupMessageKind;
  /** The group's common ground (opening and /together): bridges with whose picks led there. */
  ground?: GroupGround;
  /** /plan: the group Plan Ticket. */
  planTicket?: PlanTicket;
  places?: Place[];
  /** The command this answers, e.g. "plan". */
  cmd?: string;
}

export interface GroupView {
  id: string;
  size: GroupSize;
  createdAt: number;
  members: GroupMemberView[];
  /** Seats left. 0 when full. */
  openSeats: number;
  /** ms; 0 when joining is closed. Only the creator gets a QR to show. */
  joinOpenUntil: number;
  /** True once Larry has posted the opening. */
  opened: boolean;
  /** Larry stepped out (/excuse) until someone says /hello. */
  larryAway: boolean;
  /** A Larry reply is on its way (no typing dots for people, only this one line for Larry). */
  larryBusy: boolean;
  version: number;
  /** The newest Plan Ticket made in this group, if any. */
  planTicket?: PlanTicket;
}

/** GET /api/groups/[id]?since=<version> */
export type GroupPollResponse = { unchanged: true } | { group: GroupView; messages: GroupMessageView[] };

/** GET /api/groups: the person's groups, newest activity first. No unread counts (never addictive). */
export interface GroupSummary {
  id: string;
  size: GroupSize;
  /** The other members' names. */
  names: string[];
  openSeats: number;
  lastAt: number;
  /** "Dice and Tea, Sun 3pm": the group's plan, when it has one (every group ends at a door). */
  plan?: string;
}
export interface GroupListResponse {
  groups: GroupSummary[];
}

/** POST /api/groups { size, profile, signals? } (18+ account) -> the group and its QR. */
export interface GroupCreateResponse {
  group: GroupView;
  join: GroupJoinTicket;
}

/** The QR the creator shows. `path` = groupJoinPath(token). */
export interface GroupJoinTicket {
  token: string;
  path: string;
  /** ms */
  expiresAt: number;
}

/** POST /api/groups/join { token, action: "preview" } -> who is in it, before joining. */
export interface GroupPreviewResponse {
  names: string[];
  openSeats: number;
  size: GroupSize;
}

/** POST /api/groups/join { token, action: "join", profile, signals? } -> the group. */
export interface GroupJoinResponse {
  group: GroupView;
}

/**
 * POST /api/groups/[id]/members { action, memberId, reason?, note? }. Remove is for the creator only;
 * the others work for every member and are silent: nobody is told.
 */
export type GroupMemberAction = "remove" | "unfriend" | "block" | "report";

/** Report reasons, easy-read. */
export const GROUP_REPORT_REASONS = ["unkind", "unsafe", "spam", "underage", "other"] as const;
export type GroupReportReason = (typeof GROUP_REPORT_REASONS)[number];

/** GET /api/friends: everyone you share a group with (minus blocks). Friends come only from groups. */
export interface FriendView {
  username: string;
  displayName: string;
  /** True only when both people's "Show my check-ins to friends" switch is on. */
  sharing: boolean;
  /** Groups you share, for "Open chat". */
  groupIds: string[];
  /** A made-up demo friend of the demo account: shown with DEMO_FRIEND_LABEL, no profile link. */
  isDemoFriend?: boolean;
}
export interface FriendListResponse {
  friends: FriendView[];
}

/** Easy-read lines the UI and API share. Warm, never alarming. */
export const GROUP_COPY = {
  qrExpired: "This QR has run out of time. Ask for a fresh one.",
  qrFull: `This ${GROUP_WORD.toLowerCase()} is full now.`,
  qrClosed: "Joining is closed for this one. Ask for a fresh QR.",
  notMember: `You're not in this ${GROUP_WORD.toLowerCase()} any more.`,
  needAccount: `${GROUP_WORD}s are for signed-in accounts (18+). Your card, places and Larry still work on this phone.`,
  tooMany: `You're in a lot of ${GROUP_WORD.toLowerCase()}s already. Leave one to start or join another.`,
  empty: "Type a message first.",
  creatorOnly: `Only the person who started this ${GROUP_WORD.toLowerCase()} can do that.`,
  done: "Done.",
} as const;
