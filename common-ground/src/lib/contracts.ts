// Shared contracts for group rooms, solo chat with Larry and AI suggestions.
// Builders implement against these types; keep them stable once other code depends on them.
import type { Bridge, FirstStep, Place, Profile, TasteItem } from "./types";
import type { Mood } from "./types/signals";
import type { Stage } from "./types/titles";

/* ---------- Group common ground (2 to 5 people) ---------- */

export const ROOM_MAX_MEMBERS = 5;

export interface GroupMember {
  /** Stable id within the room or chat (not a person's real identity). */
  id: string;
  name: string;
  profile: Profile;
  /** Seat colour token, e.g. "var(--film)". */
  color: string;
}

/** A recommendation that two or more members' tastes point to, with who it came from. */
export interface GroupBridge extends Omit<Bridge, "fromA" | "fromB" | "scoreA" | "scoreB"> {
  /** memberId -> the names of that member's picks that drove this result (strongest first). */
  from: Record<string, string[]>;
}

export interface GroupGround {
  /** Items at least two members picked, with which members picked them. */
  shared: { item: TasteItem; memberIds: string[] }[];
  bridges: GroupBridge[];
  /** True when Larry chose and ordered the bridges (best first): keep that order. */
  curated?: boolean;
}

/** Implemented in src/lib/qloo.ts. Curates with one model call by default (pass charge, or curate: false). */
export type FindGroupCommonGround = (
  members: GroupMember[],
  domains?: import("./types").Domain[],
  opts?: { curate?: boolean; charge?: (usd: number) => void | Promise<void>; signal?: AbortSignal },
) => Promise<GroupGround>;

/* ---------- Group and solo chat with Larry ---------- */

export interface GroupTurn {
  role: "user" | "assistant";
  /** User turns are "[Name] text"; assistant turns are Larry's text or "[quiet]". */
  content: string;
}

export interface GroupChatInput {
  /** "group": 2-5 people in a room. "solo": one person chatting with Larry. */
  mode: "group" | "solo";
  members: GroupMember[];
  history: GroupTurn[];
  location?: { lat: number; lon: number };
  /** Done real-world First Steps on the asking device: drives the fade (practiceTurnsFor). */
  stepsDone?: number;
  /** Already-fetched ground, so the opener needs no tool round trip. */
  ground?: GroupGround;
  /** Personas by member id (members who sent one): Larry uses them and returns personaUpdates. */
  personas?: Record<string, Persona>;
  /**
   * Open to meet: two people who waved at each other at this public venue. Larry stays on what they
   * share, only ever suggests this venue, and steps in on red flags (see PRODUCT.md).
   */
  meet?: { venueName: string };
}

export interface GroupChatResult {
  messages: { from: "larry"; text: string }[];
  quiet: boolean;
  steps: Omit<FirstStep, "id" | "createdAt" | "done">[];
  profileUpdates: { memberId: string; item: TasteItem }[];
  crisis?: boolean;
  /** Solo mode: the session has run its course; the client stops and points to a room or a First Step. */
  wrapUp?: boolean;
  places?: Place[];
  ground?: GroupGround;
  /** The concrete real-world plan, built only from a real Qloo place and a real shared item. */
  planTicket?: PlanTicket;
  /** Solo: what Larry learned about the person this turn. */
  personaUpdate?: PersonaUpdate;
  /** Group: what Larry learned about each member who sent a persona, by member id. */
  personaUpdates?: Record<string, PersonaUpdate>;
}

/** Implemented in src/lib/agent.ts. onProgress gets tool progress lines like the pair chat. */
export type RunGroupChat = (
  input: GroupChatInput,
  onProgress?: (p: { tool: string; text: string }) => void,
  /** Optional: a budget hold taken by the caller (so it is held before a message is posted), and an abort signal. */
  opts?: { budget?: import("./budget").BudgetHold; signal?: AbortSignal; charge?: (usd: number) => void | Promise<void> },
) => Promise<GroupChatResult>;

/* ---------- AI-written suggestions and nudges ---------- */

export interface SuggestInput {
  /** The person who will read the ideas first, then the others they are with (if any). */
  names: string[];
  /** Real items only: picks, bridges and places the suggestions may mention. */
  picks: string[];
  bridges: string[];
  places: { name: string; kind?: string }[];
  /** "steps": three First Step ideas. "nudges": short warm lines (max 5 words) for a practice chat. */
  kind: "steps" | "nudges";
}

export interface SuggestResult {
  steps: { kind: "go" | "say" | "show"; text: string }[];
  nudges: string[];
  /** True when the model was unavailable and fixed fallback text was used. */
  fallback: boolean;
}

/** One tap in the private check-in after a place step: why it felt the way it did. */
export type CheckInReason = "too_loud" | "no_one" | "cant_find" | "loved";

/**
 * POST /api/suggest { kind: "next_rung", ... }: Larry picks the next place on the Quiet-to-Lively
 * ladder from real candidates, after a private check-in. Charged to the access code; without one
 * (or when the model fails) the fixed table answers (fallback: true).
 */
export interface NextRungInput {
  kind: "next_rung";
  step: { text: string; placeId?: string; placeName?: string; vibe?: PlaceVibe };
  feeling: import("./types").Feeling;
  reason?: CheckInReason;
  /** Real places Larry may choose from (from saved plans and Qloo), with what is known about each. */
  candidates: { id: string; name: string; vibe: PlaceVibe; tags?: string[]; about?: string }[];
  persona?: { picks: string[]; placeVibe?: PlaceVibe };
}

export interface NextRungResult {
  /** The chosen candidate, or none when no candidate suits the rung (then ask Larry for a place). */
  placeId?: string;
  vibe: PlaceVibe;
  move: "up" | "stay" | "back";
  /** One plain line: why this place, next. */
  why: string;
  /** What Larry learned from the check-in, for the persona (shown as "Larry learned: ..."). */
  learned?: PersonaUpdate;
  fallback: boolean;
}

/**
 * POST /api/suggest { kind: "plan_b", ... }: Larry writes an if-then plan B for the worry someone
 * tapped on a Plan Ticket. For "travel", Qloo is asked again within 1 km for a real, nearer place.
 */
export interface PlanBInput {
  kind: "plan_b";
  obstacle: "nervous" | "words" | "alone" | "travel";
  place: { id: string; name: string; vibe?: PlaceVibe; tags?: string[] };
  item?: { id: string; name: string };
  /** Pick ids for the nearer-place search when there is no shared item. */
  picks?: string[];
  location?: { lat: number; lon: number };
}

export interface PlanBResult {
  planB: string;
  /** The real nearer place Qloo found (for "travel"), if any. */
  nearer?: { id: string; name: string; distanceKm?: number };
  fallback: boolean;
}

/* ---------- Rooms (live, multi-device) ---------- */

export interface RoomMember extends GroupMember {
  joinedAt: number;
  lastSeenAt: number;
}

export interface RoomMessage {
  id: string;
  /** A member id, or "larry". */
  from: string;
  text: string;
  at: number;
  /** True when the sender asked Larry; false for "Just us" messages between people. */
  toLarry: boolean;
  /**
   * Sent while Larry was excused: kept for the people in the room, never sent to Larry
   * (left out of the history runGroupChat gets, whatever happens later).
   */
  excused?: boolean;
}

export interface Room {
  code: string;
  createdAt: number;
  members: RoomMember[];
  messages: RoomMessage[];
  steps: Omit<FirstStep, "id" | "createdAt" | "done">[];
  /** Increments on every change; clients poll with ?since=version. */
  version: number;
  /** True while Larry is replying, so only one agent run happens per room at a time. */
  larryBusy: boolean;
  ground?: GroupGround;
  /** Calm places Larry found near the group most recently (PlaceCards with vibe and each member's fit). */
  places?: (Place | PlaceCard)[];
  /** The plan Larry made for the group most recently (a real Qloo place and a real shared item). */
  planTicket?: PlanTicket;
  /**
   * Open to meet rooms only (members only, after a mutual wave): the public venue the two are at and
   * what they share. These rooms can't be joined, Larry can't be excused, and no location is used.
   * `left`: people who were in the room and left, so Block and Report still work on them.
   */
  meet?: { venueName: string; shared: string[]; left?: { id: string; name: string }[] };
  /**
   * True while someone in the room has excused Larry: Larry reads nothing and replies to nothing
   * until someone says hello again. Room-wide, so every member sees the same state.
   */
  larryAway?: boolean;
  /**
   * When Larry last came back (ms). Larry starts fresh then: it never reads messages from before
   * this time, so nothing said before or during the time it was excused reaches it.
   */
  larryBackAt?: number;
}

/**
 * What someone who is not (or no longer) a member sees: enough to decide whether to join, and
 * nothing of the chat, the cards, the steps or the places.
 */
export interface RoomPreview {
  code: string;
  /** Names of the people in the room now. */
  names: string[];
  /** Seats a new person can take. Seats of phones that went away long ago count as free. */
  openSeats: number;
}

/** What a member's device stores to post as that member. */
export interface RoomCredentials {
  code: string;
  memberId: string;
  token: string;
}

/*
 * Meet chat HTTP API (src/app/api/rooms/**), used only by Open to meet chats after a mutual wave.
 * Creating or joining a chat by code is retired (friends-first: every other chat is a group made by QR).
 *   GET  /api/rooms/[code]?since=<ver>   (x-member-id, x-member-token)       -> { room } | { unchanged: true }
 *   POST /api/rooms/[code]/messages       { memberId, token, text, toLarry, excused? } -> { room, crisis? }
 *   POST /api/rooms/[code]/larry          { memberId, token, away }           -> { room }
 *   POST /api/rooms/[code]/leave          { memberId, token }                 -> { ok: true }
 * Chats expire 6 hours after the last change.
 */

/* ---------- Persona: Larry's saved, improving picture of someone's taste ---------- */

/** Stored on the person's device (localStorage); sent with chat requests so Larry can use and update it. */
export interface Persona {
  version: 1;
  name: string;
  /** Everything the person has picked or Larry has confirmed they love. No upper limit in the app. */
  likes: TasteItem[];
  /** Things they said they don't enjoy (names or Qloo items), so Larry avoids them. */
  dislikes: { name: string; id?: string; domain?: import("./types").Domain }[];
  /** Short plain-language notes Larry learned, e.g. "prefers calm places", "plays cricket". At most ~20, newest first. */
  notes: string[];
  /** Place preferences learned from chats and check-ins. */
  placeVibe?: "calm" | "cosy" | "lively";
  updatedAt: number;
}

/** What Larry may change in a persona after a chat turn; the client merges it and shows "Larry learned: ...". */
export interface PersonaUpdate {
  addLikes: TasteItem[];
  addDislikes: Persona["dislikes"];
  addNotes: string[];
  placeVibe?: Persona["placeVibe"];
}

/* ---------- Places with vibe tags and per-person fit (Plan Ticket, Ladder) ---------- */

export type PlaceVibe = "calm" | "cosy" | "lively";

export interface PlaceFit {
  /** Member id or "a"/"b" in the pair session. */
  who: string;
  likely: "likes" | "maybe" | "not-for-them";
  /** Plain reason grounded in that person's persona and Qloo data, e.g. "board games, and it's quiet". */
  why: string;
}

export interface PlaceCard extends Place {
  vibe?: PlaceVibe;
  /** Plain tags from Qloo's own place data, e.g. ["Calm", "Board games", "Wi-Fi"]. */
  tags: string[];
  /** Opening hours text, if Qloo has it. */
  hours?: string;
  fits: PlaceFit[];
  /** 2-3 daytime chips like "Sat 11am", from the opening hours. Empty when hours are unknown. */
  slots?: string[];
  /** Qloo's short description of the place, when it has one. */
  about?: string;
  /** The venue's own coordinates from Qloo (public business data, never the asker's). */
  at?: { lat: number; lon: number };
}

/** The concrete real-world plan at the end of a session. */
export interface PlanTicket {
  place: PlaceCard;
  /** e.g. "Sat 11am"; only daytime slots, never presented as a booking. */
  when: string;
  /** The shared bridge item to bring up or show. */
  item?: { id: string; name: string; domain: import("./types").Domain; image?: string };
  /** One easy opener grounded in the shared item. */
  opener: string;
  /** If-then backup the person chose, e.g. "If it's too busy, we'll walk to the bookshop next door." */
  planB?: string;
  /** Ladder rung this plan represents (0 = calmest). */
  rung?: number;
  /** One line from Larry: what to do there, tied to the shared item (e.g. "Find a two-player co-op game and play one round"). */
  todo?: string;
  /* Final build (0D, additive). */
  /** Stable id, so co-presence (LeaveRequest.ticketId) can name the plan. */
  id?: string;
  /** The one if-then line the person commits to: "If it's Sat 3pm, then I walk to Café Condi and say 'Have you played Cascadia?'" */
  ifThen?: string;
  /** Optional guess "How do you think it'll go?" (1 = rough, 5 = great), at most once a week. Stays on the device. */
  guess?: 1 | 2 | 3 | 4 | 5;
  /** The worry the person tapped, if any. */
  obstacle?: Obstacle;
  /** The mood the plan was made in (gentler, shorter wording for low energy). */
  mood?: Mood;
  /** "matchday": watch the next daytime game (or highlights) at a calm place with a screen. */
  variant?: "standard" | "matchday";
  /** The area Larry picked first (urn:heatmap), e.g. "Bandra". */
  area?: string;
  /** An optional second stop, in walking order: a different real Qloo place nearby. */
  then?: { place: PlaceCard; walkMin?: number; todo?: string };
}

/**
 * What might get in the way, on the Plan Ticket. The first four have a Larry-written plan B
 * (PlanBInput); "loud" (STRETCH) and "leave" are new in the final build.
 */
export type Obstacle = PlanBInput["obstacle"] | "loud" | "leave";

/* ---------- Check-ins and private milestones ---------- */

export interface CheckIn {
  placeId: string;
  placeName: string;
  at: number;
}

/** @deprecated Use Stage (src/lib/types/titles.ts): Rookie 1, Regular 3, Veteran 6, Elite 10, Legend 20. */
export type Milestone = Stage;

/* ---------- Open to meet (see PRODUCT.md: mutual, 18+, shared interest, no stalking) ---------- */

/*
 * Server-side, short-lived, per venue. Open, list and wave need an access code, a device id and proof of presence:
 * the phone's fix { lat, lon, accuracy } must be within 150 m of the venue's Qloo coordinates (checked, never stored).
 *   POST /api/meet/[placeId]/open     { deviceId, persona, adult: true, where } -> { sessionId, expiresAt }  (3h max; same picks all visit)
 *   POST /api/meet/[placeId]/close    { sessionId }                        -> { ok }
 *   GET  /api/meet/[placeId]  (x-meet-session, x-meet-where headers)
 *        -> { venue, expiresAt, groups: { groupId, kind, thing, count, line, waved }[], matches }
 *        Anonymous counts per shared thing ("2 people here like Ghibli"); each person counted under one thing, only
 *        with a Qloo bridge or 2+ shared picks. groupId is per viewer, venue and visit. Leaving the venue switches off.
 *   POST /api/meet/[placeId]/wave     { sessionId, groupId, where }        -> { mutual: false } | { mutual: true, roomCode, credentials }
 *   POST /api/meet/block              { sessionId, groupId } | { room, targetMemberId }  -> { ok }  (permanent, both ways, everywhere;
 *                                        works for someone who has already left the room)
 *   POST /api/meet/report             { ...same target, reason, note? }   -> { ok }
 * Production refuses open/list/wave unless durable storage (Firestore or Upstash) and MEET_SECRET are set (blocks must last for good).
 * No endpoint ever returns a location, schedule, history, name or photo before a mutual wave.
 */

/* ---------- Access codes (per-code AI budget) ---------- */

/** Codes are created with `npm run codes -- <count> --cents 25`, stored hashed; the client sends the code in the
 * `x-larry-code` header. Each AI call (chat, rooms, solo, suggest, meet chat) is charged to the code; when its
 * budget is spent the server answers 402 { error: "This code has used its AI time." }. */
export const CODE_BUDGET_CENTS = 25;
