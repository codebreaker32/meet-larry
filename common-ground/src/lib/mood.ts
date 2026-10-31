"use client";

// Mood and Hidden Gems on the device, and the `signals` every one of the person's own requests carries.
// Mood is one tap, optional and changeable any time. It never syncs and is never shown to anyone else
// (next-round-queue.md "Mood option"; glossary "Moods"). Words and icons follow docs/glossary.md.

import type { LucideIcon } from "lucide-react";
import { Armchair, BatteryLow, MessagesSquare, Telescope, Zap } from "lucide-react";
import { STORAGE_KEYS } from "./types/storage-keys";
import { AGE_BUCKETS, MOODS, type AgeBucket, type Mood, type RequestSignals } from "./types/signals";
import { readStored, useStored, writeStored } from "./storage";

export interface MoodInfo {
  label: string;
  icon: LucideIcon;
  /** Shown when chosen. */
  meaning: string;
}

/** The glossary's words, icons and meaning lines. */
export const MOOD_INFO: Record<Mood, MoodInfo> = {
  chill: { label: "Chill", icon: Armchair, meaning: "Calm and close by. No rush." },
  social: { label: "Social", icon: MessagesSquare, meaning: "Up for people today." },
  curious: { label: "Curious", icon: Telescope, meaning: "Show me something I don't know." },
  "low-energy": { label: "Low energy", icon: BatteryLow, meaning: "Short, gentle and easy." },
  hype: { label: "Hype", icon: Zap, meaning: "Bring the noise." },
};

export const isMood = (v: unknown): v is Mood => typeof v === "string" && (MOODS as readonly string[]).includes(v);
export const isAgeBucket = (v: unknown): v is AgeBucket =>
  typeof v === "string" && (AGE_BUCKETS as readonly string[]).includes(v);

/** Today's mood: null when none is picked, undefined on the server. */
export function useMood(): Mood | null | undefined {
  const v = useStored<unknown>(STORAGE_KEYS.mood, null);
  return v === undefined ? undefined : isMood(v) ? v : null;
}

/** Picks a mood, or clears it with null. False when the phone refused to save it. */
export const saveMood = (m: Mood | null): boolean => writeStored(STORAGE_KEYS.mood, m);

/** The Hidden Gems switch (off by default); undefined on the server. */
export function useHiddenGems(): boolean | undefined {
  const v = useStored<unknown>(STORAGE_KEYS.hiddenGems, false);
  return v === undefined ? undefined : v === true;
}

export const saveHiddenGems = (on: boolean): boolean => writeStored(STORAGE_KEYS.hiddenGems, on || null);

/**
 * The `signals` field for the person's own request bodies, read fresh from the device. Fields that are
 * not set are left out, so an empty object means "no signals". Never put this in a room message,
 * an Open to meet payload or anything another person sees.
 */
export function requestSignals(): RequestSignals {
  if (typeof window === "undefined") return {};
  const mood = readStored<unknown>(STORAGE_KEYS.mood, null);
  const age = readStored<unknown>(STORAGE_KEYS.ageBucket, null);
  const gems = readStored<unknown>(STORAGE_KEYS.hiddenGems, false);
  return {
    ...(isMood(mood) ? { mood } : {}),
    ...(isAgeBucket(age) ? { ageBucket: age } : {}),
    ...(gems === true ? { hiddenGems: true } : {}),
  };
}

/** `requestSignals()` as an optional body field: undefined when nothing is set. */
export function signalsField(): { signals?: RequestSignals } {
  const s = requestSignals();
  return Object.keys(s).length ? { signals: s } : {};
}

/** How many recent place ids a request carries (chat-protocol RECENT_PLACES_MAX). */
const RECENT_MAX = 30;
const PLACE_ID = /^[\w.:-]{1,64}$/;

/**
 * Places this phone already has plans for, newest first: saved tickets (steps with a placeId). Visits
 * are never sent (check-ins stay counts on the phone). The server puts them after fresh places, so Larry stops repeating
 * the same spots. Sent only with the person's own requests; never shown to anyone else.
 */
export function recentPlaceIds(): string[] {
  if (typeof window === "undefined") return [];
  const out: string[] = [];
  const add = (id: unknown) => {
    if (typeof id === "string" && PLACE_ID.test(id) && !out.includes(id) && out.length < RECENT_MAX) out.push(id);
  };
  const steps = readStored<unknown>(STORAGE_KEYS.steps, []);
  if (Array.isArray(steps)) for (const s of steps) if (s && typeof s === "object") add((s as { placeId?: unknown }).placeId);
  return out;
}

/** `recentPlaceIds()` as an optional body field: undefined when there are none. */
export function recentPlacesField(): { recentPlaces?: string[] } {
  const ids = recentPlaceIds();
  return ids.length ? { recentPlaces: ids } : {};
}
