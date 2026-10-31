// Shared by client and server: limits and the /api/chat response stream.
import type { PersonaUpdate, PlaceCard, PlanTicket } from "./contracts";
import type { Bridge, FirstStep, Place, TasteItem } from "./types";

/** Turns the client keeps and the server reads. Older turns are dropped, not rejected. */
export const HISTORY_TURNS = 40;
/** Longest single message. The composer stops here; the server truncates anything longer. */
export const MESSAGE_MAX = 600;
/** Practice rounds end after this many messages from the person, with a real-world step. */
export const PRACTICE_TURNS = 8;
/**
 * The fade: every real-world First Step marked done shortens practice rounds (8, then 6, then 4).
 * The client sends `stepsDone` with each chat request; both sides use this to agree on the cap.
 */
export function practiceTurnsFor(stepsDone: number): number {
  const done = Number.isFinite(stepsDone) ? Math.max(0, Math.floor(stepsDone)) : 0;
  return Math.max(4, PRACTICE_TURNS - 2 * Math.min(done, 2));
}

/**
 * Optional `recentPlaces` on /api/chat, /api/larry, /api/places and room messages: ids of places
 * this phone was shown lately (newest first, at most this many). Those places go after fresh ones,
 * so Larry doesn't offer the same venue every time. Kept on the device; the server keeps nothing.
 */
export const RECENT_PLACES_MAX = 30;

export interface ChatMessageOut {
  from: "larry" | "b";
  text: string;
}

export interface PairChatResult {
  messages: ChatMessageOut[];
  quiet: boolean;
  steps: Omit<FirstStep, "id" | "createdAt" | "done">[];
  profileUpdates: { person: "a" | "b"; item: TasteItem }[];
  /** True when the server saw a possible crisis and replied with help instead of the model. */
  crisis?: boolean;
  /** True when a practice round has ended; the client stops the chat and offers the First Step. */
  wrapUp?: boolean;
  /** Places the agent found this turn (PlaceCards with vibe and per-seat fits), so the client can offer them. */
  places?: (Place | PlaceCard)[];
  /** Fresh bridges if the agent re-ran common ground this turn (e.g. after add_interest). */
  bridges?: Bridge[];
  /**
   * The concrete real-world plan, built only from a real Qloo place and a real shared item. May
   * carry `then`: a second stop in order, a short walk on (agent.ts TicketStop).
   */
  planTicket?: PlanTicket & { then?: { place: PlaceCard; walkMin?: number; todo?: string } };
  /** What Larry learned about the phone owner (their seat only) this turn. */
  personaUpdate?: PersonaUpdate;
}

/**
 * POST /api/chat answers with newline-delimited JSON (application/x-ndjson):
 * zero or more "progress" events while tools run, then one "done" or "error".
 * Failures before the stream starts (bad request, rate limit, budget) are a normal JSON
 * `{ error }` body with a 4xx/5xx status.
 */
export type ChatEvent =
  | { type: "progress"; tool: string; text: string }
  | { type: "done"; result: PairChatResult }
  | { type: "error"; error: string };
