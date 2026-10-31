"use client";

// The age range, asked once at card creation as a range, never a birthday (next-round-queue.md "Age").
// Minimum age 13. Stored on the device; only the coarse bucket goes with the person's own requests.
// Never shown to anyone: not in rooms or Open to meet.
// Signed in: the account's date of birth decides the bucket (call `saveAgeFromAccount` after sign-in),
// so the device bucket and the 18+ account can never disagree.

import { STORAGE_KEYS } from "./types/storage-keys";
import { AGE_BUCKETS, isAdultBucket, type AgeBucket } from "./types/signals";
import { DEVICE_MIN_AGE } from "./types/account";
import { useStored, writeStored } from "./storage";
import { isAgeBucket } from "./mood";

/** Easy-read words for each range (an en dash reads "to" on screen readers). */
export const AGE_LABELS: Record<AgeBucket, string> = {
  "13-17": "13–17",
  "18-24": "18–24",
  "25-34": "25–34",
  "35-44": "35–44",
  "45+": "45+",
};

export const AGE_OPTIONS = AGE_BUCKETS.map((b) => ({ value: b, label: AGE_LABELS[b] }));

/** Whole years to the range they fall in; null under 13 (no card, a kind message instead). */
export function bucketForAge(age: number): AgeBucket | null {
  if (!Number.isFinite(age) || age < DEVICE_MIN_AGE) return null;
  if (age < 18) return "13-17";
  if (age < 25) return "18-24";
  if (age < 35) return "25-34";
  if (age < 45) return "35-44";
  return "45+";
}

/** The stored range: null when not asked yet, undefined on the server. */
export function useAgeBucket(): AgeBucket | null | undefined {
  const v = useStored<unknown>(STORAGE_KEYS.ageBucket, null);
  return v === undefined ? undefined : isAgeBucket(v) ? v : null;
}

/** False when the phone refused to save it. */
export const saveAgeBucket = (b: AgeBucket): boolean => writeStored(STORAGE_KEYS.ageBucket, b);

/** After sign-in (1F): the account's age decides the device bucket. Accounts are 18+. */
export function saveAgeFromAccount(age: number): boolean {
  const b = bucketForAge(age);
  return b ? saveAgeBucket(b) : false;
}

/**
 * Under-18 gating (Stage 1 gate G2). Unknown age counts as under 18 (D17).
 * - Open to meet: 18+ only, so the entry is hidden for everyone else.
 * - Rooms: under 18, only by invite code (no friend invites or public rooms, which need an 18+ account anyway).
 */
export const canOpenToMeet = (b: AgeBucket | null | undefined): boolean => isAdultBucket(b);
export const roomsByCodeOnly = (b: AgeBucket | null | undefined): boolean => !isAdultBucket(b);
