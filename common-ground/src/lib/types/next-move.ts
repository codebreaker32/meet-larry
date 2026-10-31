// Larry's next move: the one big card on home (component-specs 3). nextMove() is pure; its body
// is in src/lib/next-move.ts.
import type { PlanTicket } from "../contracts";
import type { TasteItem } from "../types";
import type { PlaceCounter } from "./checkin";
import type { AgeBucket, Mood } from "./signals";
import type { FriendTitle, Stage } from "./titles";

export type MoveKind =
  | "make-card"
  | "fingerprint"
  | "second-person"
  | "warm-up"
  | "open-to-meet"
  | "plan"
  | "reminder"
  | "check-in"
  | "weekly";

/** Spark: give a reason. Facilitator: hand over the ready plan. Signal: a minimal reminder. Never shown as a label. */
export type PromptType = "spark" | "facilitator" | "signal";

export interface NextMove {
  kind: MoveKind;
  /** The move in a few words, e.g. "Board games at Café Condi?" */
  title: string;
  /** Larry's grounded line (labelled AI where shown). Omitted facts are never invented. */
  why: string;
  /** The same reason in one plain easy-read line (R6). */
  plainWhy: string;
  cta: { label: string; href: string };
  prompt: PromptType;
  /** "second-person" only: the other two ways (invite, warm up, Open to meet for 18+). */
  alternatives?: { label: string; href: string }[];
  /** Check-in moves: progress to the next stage, and a friend title within reach (D14, owner only). */
  progress?: { stage: Stage; visitsAway: number; friendTitle?: { title: FriendTitle; visitsAway: number } };
  /** Real evidence behind the reason, when there is some. */
  evidence?: { item?: TasteItem; placeId?: string; placeName?: string };
  /** A quiet week: an easy, close option, never a mention of the gap. */
  restWeek?: boolean;
  /** After 2 ignored moves: offer something smaller. */
  backOff?: boolean;
}

export interface JourneyState {
  hasCard: boolean;
  fingerprintSeen: boolean;
  /** Real people met through Larry (rooms, pair sessions, accepted friends). */
  peopleMet: number;
  openTicket?: PlanTicket;
  counters: PlaceCounter[];
  mood?: Mood;
  ageBucket?: AgeBucket;
  /** City or area name, for weekly picks (Rising, Match Day). */
  area?: string;
  /** Moves shown and skipped ("Not now" or ignored), most recent last. */
  ignoredMoves: MoveKind[];
  /** False for 13-17 and unknown age: no Open to meet, no nudges. */
  isAdult: boolean;
  source: "web";
}

/** src/lib/next-move.ts (2A). Pure: same state and time, same move. */
export type NextMoveFn = (state: JourneyState, now: Date) => NextMove;
