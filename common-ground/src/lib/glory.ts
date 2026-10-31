"use client";

// Glory on the device (D3, spec 2): a lifetime total earned only by verified real-world actions.
// Never from chat, app opens or money. Never goes down. Device-only people keep it here; an account
// also keeps it on the server (the leave route adds it), and screens show max(device, server) so it
// never appears to drop while syncing.
import { useSyncExternalStore } from "react";
import { GLORY_RULES, gloryFor, type GloryEvent } from "./types/glory";
import { STORAGE_KEYS } from "./types/storage-keys";

export { GLORY_RULES, gloryFor, type GloryEvent };

const KEY = STORAGE_KEYS.deviceGlory;
/** A sane ceiling, so a broken value in storage can't show a silly number. */
const MAX_GLORY = 10_000_000;

/** A stored value as a whole number 0 or more; anything else is 0. */
export function parseGlory(raw: string | null | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(MAX_GLORY, Math.floor(n)) : 0;
}

/** Pure: the new total after a gain. A negative or broken gain adds nothing, so it never drops. */
export function addGlory(total: number, gain: number): number {
  const base = Math.max(0, Math.floor(Number.isFinite(total) ? total : 0));
  const add = Number.isFinite(gain) && gain > 0 ? Math.floor(gain) : 0;
  return Math.min(MAX_GLORY, base + add);
}

/** What to show when both a device and a server value may exist: whichever is higher. */
export const shownGlory = (device: number, server?: number | null) => Math.max(parseGlory(String(device)), parseGlory(String(server ?? 0)));

/** The Glory a verified leave earns, for the device total. Unverified visits earn none. */
export function gloryForVisit(verified: boolean, saidHi: boolean): { amount: number; events: GloryEvent[] } {
  if (!verified) return { amount: 0, events: [] };
  const events: GloryEvent[] = saidHi ? ["visit", "said-hi"] : ["visit"];
  return { amount: gloryFor(events), events };
}

/* ---------- This device's storage ---------- */

const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function loadGlory(): number {
  return parseGlory(read());
}

/** Adds a gain on this device. Returns the new total. Never lowers it. */
export function earnGlory(gain: number): number {
  const next = addGlory(loadGlory(), gain);
  try {
    localStorage.setItem(KEY, String(next));
  } catch {
    // Storage blocked: the gain still shows for this visit.
  }
  listeners.forEach((l) => l());
  return next;
}

/** This device's Glory; undefined while rendering on the server. */
export function useGlory(): number | undefined {
  const raw = useSyncExternalStore(subscribe, read, () => undefined);
  return raw === undefined ? undefined : parseGlory(raw);
}
