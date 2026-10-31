// Account sync on the device (D11): folded counts only, at most once a day, never fired by the leave
// tap. "We keep counts, not a diary": no weeks bitset, no week number, no arrive or leave times and
// no step times ever leave the phone. On a new phone, an empty device gets the account's copy back.
import type { FirstStep } from "../types";
import type { Persona } from "../contracts";
import { loadPersona, parsePersona, savePersona } from "../persona";
import type { SyncBlob } from "../types/account";
import type { PlaceCounter, SyncedPlaceCounter } from "../types/checkin";
import { AGE_BUCKETS, type AgeBucket } from "../types/signals";
import { STORAGE_KEYS } from "../types/storage-keys";

export const SYNC_EVERY_MS = 24 * 60 * 60 * 1000;

const readJson = (key: string): unknown => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};
const writeJson = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
    window.dispatchEvent(new StorageEvent("storage", { key }));
  } catch {}
};

/** Only the SyncedPlaceCounter fields, whatever else the device keeps. */
export function foldCounter(c: PlaceCounter | SyncedPlaceCounter): SyncedPlaceCounter {
  return { placeId: c.placeId, placeName: c.placeName, visits: c.visits, stage: c.stage, spotWeeks: c.spotWeeks };
}

/** Drops every time field from a step ("doneAt", "checkedAt"); the schema drops them too. */
function stepWithoutTimes(s: FirstStep): FirstStep {
  const rest = { ...(s as FirstStep & { doneAt?: unknown; checkedAt?: unknown }) };
  delete rest.doneAt;
  delete rest.checkedAt;
  return rest;
}

const isAge = (v: unknown): v is AgeBucket => typeof v === "string" && (AGE_BUCKETS as readonly string[]).includes(v);

/** What this device would send: persona, steps, folded counters and the age range. Nothing else. */
export function buildSyncBlob(): SyncBlob {
  const steps = readJson(STORAGE_KEYS.steps);
  const counters = readJson(STORAGE_KEYS.placeCounters);
  const age = readJson(STORAGE_KEYS.ageBucket) ?? (() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.ageBucket);
    } catch {
      return null;
    }
  })();
  return {
    persona: loadPersona(),
    steps: Array.isArray(steps) ? (steps as FirstStep[]).slice(0, 300).map(stepWithoutTimes) : [],
    placeCounters: Array.isArray(counters) ? (counters as PlaceCounter[]).filter((c) => c?.placeId).slice(0, 500).map(foldCounter) : [],
    ...(isAge(age) ? { ageBucket: age } : {}),
  };
}

/** Fills an empty device from the account's copy. Never overwrites what the device already has. */
export function restoreFromAccount(remote: SyncBlob): string[] {
  const restored: string[] = [];
  const persona: Persona | null = remote.persona ? parsePersona(remote.persona) : null;
  if (persona && !loadPersona()) {
    savePersona(persona);
    restored.push("persona");
  }
  const steps = readJson(STORAGE_KEYS.steps);
  if (remote.steps.length && (!Array.isArray(steps) || !steps.length)) {
    writeJson(STORAGE_KEYS.steps, remote.steps);
    restored.push("steps");
  }
  const counters = readJson(STORAGE_KEYS.placeCounters);
  if (remote.placeCounters.length && (!Array.isArray(counters) || !counters.length)) {
    // The weeks history stayed on the old phone, so it starts fresh here; the counts come back.
    const full: PlaceCounter[] = remote.placeCounters.map((c) => ({ ...foldCounter(c), weeksBits: "", totalWeeks: 0, lastIsoWeek: "" }));
    writeJson(STORAGE_KEYS.placeCounters, full);
    restored.push("places");
  }
  return restored;
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Syncs once if the last sync was a day or more ago (or `force`). Pulls first to fill an empty
 * device, then pushes the device's folded counts. Quiet on failure: it tries again next time.
 */
export async function syncAccount(fetcher: Fetcher, opts: { force?: boolean; now?: number } = {}): Promise<"skipped" | "synced" | "failed"> {
  const now = opts.now ?? Date.now();
  let last = 0;
  try {
    last = Number(localStorage.getItem(STORAGE_KEYS.lastSync) ?? 0) || 0;
  } catch {}
  if (!opts.force && now - last < SYNC_EVERY_MS) return "skipped";
  try {
    const got = await fetcher("/api/account/sync");
    if (got.ok) restoreFromAccount((await got.json()) as SyncBlob);
    const put = await fetcher("/api/account/sync", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildSyncBlob()),
    });
    if (!put.ok) return "failed";
    try {
      localStorage.setItem(STORAGE_KEYS.lastSync, String(now));
    } catch {}
    return "synced";
  } catch {
    return "failed";
  }
}
