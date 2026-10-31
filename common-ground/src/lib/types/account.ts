// Accounts (D4, D18): phone OTP through Firebase, 18+ only. The client sends
// `Authorization: Bearer <Firebase ID token>`; the server verifies it per request (getSession).
// Phone number and date of birth are never shown to anyone; only the username is.
import type { FirstStep } from "../types";
import type { Persona } from "../contracts";
import type { SyncedPlaceCounter } from "./checkin";
import type { AgeBucket } from "./signals";
import type { PublicTitleCounts } from "./titles";

/** Day, month (1-12, picked as a word on screen) and year. Used for the 18+ check, stored, never shown. */
export interface DateOfBirth {
  d: number;
  m: number;
  y: number;
}

/** POST /api/account */
export interface SignupRequest {
  name: string;
  /** Picked from the generator (GET /api/account/username), e.g. "QuietOtter42". */
  username: string;
  dob: DateOfBirth;
}

/** GET /api/account, POST /api/account. Never carries the phone number or date of birth. */
export interface Account {
  uid: string;
  name: string;
  username: string;
  /** ms */
  createdAt: number;
  budgetCentsLeft: number;
  glory: number;
  /** "Show my check-ins to friends": off by default. */
  sharingWithFriends: boolean;
  /**
   * D12 "Show me on place leaderboards": off by default (DEFAULT_SHOW_ON_LEADERBOARDS). While off,
   * visits still count for private stages and Glory, but the person is on no public podium.
   */
  showOnLeaderboards: boolean;
  /** Synced from the device at most once a day (see SyncBlob). */
  publicTitleCounts: PublicTitleCounts;
  /** The age range worked out from the date of birth (never the date itself), so the device range matches the account. */
  ageBucket?: AgeBucket;
}

/** D12: nobody is on a public podium unless they switch it on. */
export const DEFAULT_SHOW_ON_LEADERBOARDS = false;

/** PATCH /api/account: the account's own switches. Send only the ones that change. */
export interface AccountSettingsRequest {
  showOnLeaderboards?: boolean;
}

/** GET /api/account/username: a fresh public-safe username; call again to re-roll. */
export interface UsernameResponse {
  username: string;
}

/**
 * GET/PUT /api/account/sync. Folded counts only (D11): no weeks bitset, no dates. The client
 * debounces it to at most once a day and never fires it from the leave tap.
 */
export interface SyncBlob {
  persona: Persona | null;
  steps: FirstStep[];
  placeCounters: SyncedPlaceCounter[];
  ageBucket?: AgeBucket;
  /** Public title counts the device worked out from the podiums it can read; copied to Account. */
  publicTitleCounts?: PublicTitleCounts;
}

/**
 * A verified request's account. Accounts are 18+, so isAdult is always true. Server-only: a Session
 * is never serialised into a response or a log.
 */
export interface Session {
  uid: string;
  isAdult: true;
  /**
   * D19: the one demo/testing account. True only when the verified Firebase token's phone_number
   * claim equals env DEMO_PHONE (src/lib/account/session.ts). It skips the check-in location,
   * closed-now and dwell checks and nothing else: no privacy exemption, and its visits count like
   * real ones. Never sent to the client, never logged, never settable by a request.
   */
  isDemo: boolean;
}

/** src/lib/account/session.ts: null with no valid bearer token. Stub in 0D, real in 1F. */
export type GetSession = (req: Request) => Promise<Session | null>;

/** Accounts are 18+ (DPDP rules on minors' data). Under-13s get a kind exit on the device. */
export const ACCOUNT_MIN_AGE = 18;
export const DEVICE_MIN_AGE = 13;

/** Whole years between a date of birth and `now` (UTC), or null for an impossible date. */
export function ageOn(dob: DateOfBirth, now: Date): number | null {
  const { d, m, y } = dob;
  if (![d, m, y].every(Number.isInteger) || m < 1 || m > 12 || d < 1 || y < 1900) return null;
  const born = new Date(Date.UTC(y, m - 1, d));
  if (born.getUTCMonth() !== m - 1 || born.getUTCDate() !== d || born.getTime() > now.getTime()) return null;
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() < m - 1 || (now.getUTCMonth() === m - 1 && now.getUTCDate() < d)) age--;
  return age;
}
