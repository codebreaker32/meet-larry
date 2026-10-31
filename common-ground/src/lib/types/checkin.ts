// Check-in v2: verified visits (arrive, then leave 20+ minutes later within 150 m of the Qloo place,
// no driving-speed jump, one per place per day). The server never stores a visit time or history:
// the visit token is signed and handed back, not kept (D11, D16, D19).
import type { Stage } from "./titles";

/** ISO week as "YYYY-Www", e.g. "2026-W44". */
export type IsoWeek = string;

/** POST /api/checkins/arrive. Optional bearer. No request field is ever logged. */
export interface ArriveRequest {
  placeId: string;
  lat: number;
  lon: number;
  accuracyM: number;
}

export interface ArriveResponse {
  /** Server-signed { placeId, t, fix }; handed back on leave, never stored on the server. */
  visitToken: string;
  /**
   * How long this visit must last to count: CHECKIN_RULES.minDwellMs, or 0 for the one demo/testing
   * account (D19, decided on the server from the verified token; the response says nothing else about it).
   */
  dwellMs: number;
}

/** POST /api/checkins/leave. Optional bearer. No request field is ever logged. */
export interface LeaveRequest {
  visitToken: string;
  lat: number;
  lon: number;
  accuracyM: number;
  /** Secret HMAC from src/lib/alias.ts (podiumKey). Read only with an 18+ session; never logged. */
  podiumKey?: string;
  /** Honour tap: "We said hi" (+5 Glory for accounts). */
  saidHi?: boolean;
  /** D15 STRETCH: the plan this visit belongs to, for co-presence. */
  ticketId?: string;
}

export type LeaveReason = "too-soon" | "too-far" | "too-fast" | "already-today" | "no-coords";

export interface LeaveResponse {
  verified: boolean;
  reason?: LeaveReason;
  /** Glory added on the server for an account (0 for device-only users and unverified visits). Never negative. */
  gloryDelta: number;
}

/** What the server learns from a valid visit token (src/lib/checkin-verify.ts, 1B). */
export interface VerifiedVisit {
  placeId: string;
  /** Arrive time, ms. Read from the token only; never written anywhere. */
  t: number;
}

/** Exported by 1B from src/lib/checkin-verify.ts; 2F uses it to gate Open to meet on a check-in at that venue. */
export type VerifyVisitToken = (token: string) => VerifiedVisit | null;

/** One place's counts. Lives on the device only; sync sends SyncedPlaceCounter. */
export interface PlaceCounter {
  placeId: string;
  placeName: string;
  /** Verified visits (one per place per day). Drives the stage. */
  visits: number;
  /**
   * One character per ISO week, oldest first, ending at lastIsoWeek: "1" visited, "0" not.
   * Stays on the device: a weeks bitset is a visit history (D11).
   */
  weeksBits: string;
  /** Weeks covered by weeksBits (its length). */
  totalWeeks: number;
  lastIsoWeek: IsoWeek;
  stage: Stage | null;
  /** Distinct weeks with a verified visit (the Spot count). Rest weeks pause it; it never goes down. */
  spotWeeks: number;
  /** Visits without a verified leave (D16): shown as "Visited", no stage progress, no Glory. */
  unverified?: number;
}

/** What account sync sends (D11): folded counts only, no weeks bitset, no dates. */
export type SyncedPlaceCounter = Pick<PlaceCounter, "placeId" | "placeName" | "visits" | "stage" | "spotWeeks">;

export const CHECKIN_RULES = {
  /**
   * A visit counts when leave comes at least this long after arrive (20 minutes, user decision).
   * No env override: only the demo/testing account (Session.isDemo, D19) skips it.
   */
  minDwellMs: 20 * 60e3,
  /** Both fixes must be within this distance of the Qloo place coordinates. */
  radiusM: 150,
  /** Faster than this between fixes reads as driving past, not visiting. */
  maxSpeedKmh: 25,
  perPlacePerDay: 1,
  /** TTL of the HMAC day key that enforces one visit per place per day. */
  dayKeyTtlMs: 26 * 3600e3,
} as const;
