"use client";

import * as React from "react";
import { apiFetch } from "@/lib/api-client";
import { type FingerprintView, fallbackCaption } from "@/lib/fingerprint";
import type { Profile } from "@/lib/types";
import { STORAGE_KEYS } from "@/lib/types/storage-keys";

export type FingerprintState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: FingerprintView }
  | { status: "error"; message: string };

const ERROR_TEXT = "Hmm, that didn't go through. Try again in a moment?";

// One request per card per visit: /me and the card back share it, and reopening costs nothing.
const cache = new Map<string, Promise<FingerprintView>>();
const keyOf = (p: Profile) => `${p.name}|${p.items.map((i) => i.id).join(",")}`;

async function load(profile: Profile): Promise<FingerprintView> {
  const res = await apiFetch("/api/fingerprint", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ card: profile }),
  });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? ERROR_TEXT);
  const data = (await res.json()) as FingerprintView;
  if (!Array.isArray(data.strongest)) throw new Error(ERROR_TEXT);
  // An older server (or a test double) without Larry's line: the fixed caption stands in.
  if (!data.caption) data.caption = fallbackCaption(data, { name: profile.name, seed: profile.items.map((i) => i.id).join(",") });
  return data;
}

/** True once the Taste Fingerprint was seen (feeds Larry's next move). */
function markSeen() {
  try {
    localStorage.setItem(STORAGE_KEYS.fingerprintSeen, JSON.stringify(true));
  } catch {
    // Storage refused: the next move may offer the Fingerprint again, which is harmless.
  }
}

/** The Fingerprint for this card, fetched once per card and visit. Pass null to wait. */
export function useFingerprint(profile: Profile | null | undefined): FingerprintState & { retry: () => void } {
  const [state, setState] = React.useState<FingerprintState>({ status: "idle" });
  const [attempt, setAttempt] = React.useState(0);
  const key = profile && profile.items.length ? keyOf(profile) : "";
  // The card as a string, so the effect runs once per card, not once per render.
  const body = key && profile ? JSON.stringify({ name: profile.name, items: profile.items }) : "";

  React.useEffect(() => {
    if (!key || !body) return;
    const p = JSON.parse(body) as Profile;
    let live = true;
    let pending = cache.get(key);
    if (!pending) {
      pending = load(p);
      cache.set(key, pending);
      pending.catch(() => cache.delete(key));
    }
    // Only show the loading state if the answer isn't already in hand.
    const timer = setTimeout(() => live && setState((s) => (s.status === "ready" ? s : { status: "loading" })), 0);
    pending.then(
      (data) => {
        if (!live) return;
        markSeen();
        setState({ status: "ready", data });
      },
      (err: unknown) => live && setState({ status: "error", message: err instanceof Error && err.message ? err.message : ERROR_TEXT }),
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, body, attempt]);

  const retry = React.useCallback(() => setAttempt((n) => n + 1), []);
  return { ...(key ? state : { status: "idle" as const }), retry };
}

/**
 * The person's own venue names on this device (check-in counters, the open visit, saved plans), so
 * a share image can be checked against them. Read only; nothing leaves the phone.
 */
export function deviceVenueNames(): string[] {
  const out = new Set<string>();
  const read = (key: string): unknown => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };
  const take = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    for (const k of ["placeName", "venue"]) if (typeof o[k] === "string" && o[k]) out.add(o[k] as string);
    const place = o.place as Record<string, unknown> | undefined;
    if (place && typeof place.name === "string") out.add(place.name);
  };
  for (const key of [STORAGE_KEYS.placeCounters, STORAGE_KEYS.checkinsV1, STORAGE_KEYS.steps]) {
    const v = read(key);
    if (Array.isArray(v)) v.forEach(take);
  }
  take(read(STORAGE_KEYS.openVisit));
  return [...out];
}
