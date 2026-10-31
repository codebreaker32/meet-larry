"use client";

// D24: location is asked ONCE, at onboarding (<LocationAsk/>), then never again.
// After a yes, a coarse point (lat/lon rounded to 2 decimals, about 1 km) is kept on this device in
// localStorage "larry.location" with its time. It refreshes silently, with no UI, only when the
// browser says the permission is already granted. Screens that list places read it with
// useApproxLocation(); with none they show LOCATION_OFF_LINE. Settings on /me flips it with
// setLocationEnabled(). Check-in Arrive/Leave and Open to meet take a fresh precise fix at the tap
// with getPreciseFix() (no extra prompt: permission is already granted), checked on the server and
// thrown away. Nothing here ever sends the point anywhere by itself.

import * as React from "react";

export const LOCATION_KEY = "larry.location";
/** "off" = the person said no or switched it off; "on" = they said yes. Missing = never asked. */
export const LOCATION_CHOICE_KEY = "larry.location.choice";
/** The one plain line a screen shows when there is no stored point. */
export const LOCATION_OFF_LINE = "Places near you are off. Turn on in Your taste > Settings.";
/** Where that line points. */
export const LOCATION_SETTINGS_HREF = "/me#settings";

/** A silent refresh is skipped while the stored point is younger than this. */
export const LOCATION_FRESH_MS = 10 * 60 * 1000;

export interface ApproxLocation {
  /** Rounded to 2 decimals (about 1 km). */
  lat: number;
  lon: number;
  /** When it was read (ms since epoch). */
  at: number;
}

export type LocationChoice = "on" | "off" | null;

export interface PreciseFix {
  lat: number;
  lon: number;
  /** Metres, as the phone reports it. The server rejects anything worse than 300 m (D20). */
  accuracy: number;
}

const EVENT = "larry:location";

/** Round to 2 decimals (about 1.1 km of latitude). */
export function coarsen(n: number): number {
  return Math.round(n * 100) / 100;
}

function hasStorage(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

function emit() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

/** The stored coarse point, or null. Safe on the server (returns null). */
export function readStoredLocation(): ApproxLocation | null {
  if (!hasStorage()) return null;
  try {
    const raw = window.localStorage.getItem(LOCATION_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<ApproxLocation>;
    if (typeof v.lat !== "number" || typeof v.lon !== "number" || typeof v.at !== "number") return null;
    if (!Number.isFinite(v.lat) || !Number.isFinite(v.lon) || Math.abs(v.lat) > 90 || Math.abs(v.lon) > 180) return null;
    return { lat: v.lat, lon: v.lon, at: v.at };
  } catch {
    return null;
  }
}

/** What the person chose at the one ask (or in Settings). null = never asked. */
export function readLocationChoice(): LocationChoice {
  if (!hasStorage()) return null;
  try {
    const v = window.localStorage.getItem(LOCATION_CHOICE_KEY);
    return v === "on" || v === "off" ? v : null;
  } catch {
    return null;
  }
}

/** True once the onboarding ask has been answered either way: never ask again. */
export function hasAnsweredLocationAsk(): boolean {
  return readLocationChoice() !== null;
}

function writeChoice(choice: Exclude<LocationChoice, null>) {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(LOCATION_CHOICE_KEY, choice);
  } catch {
    // Private mode with storage full: the ask may show again next visit, which is harmless.
  }
}

function store(lat: number, lon: number): ApproxLocation {
  const point = { lat: coarsen(lat), lon: coarsen(lon), at: Date.now() };
  if (hasStorage()) {
    try {
      window.localStorage.setItem(LOCATION_KEY, JSON.stringify(point));
    } catch {
      // Storage refused: the point still goes back to the caller for this visit.
    }
  }
  return point;
}

function clearStored() {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(LOCATION_KEY);
  } catch {
    // Nothing to clear.
  }
}

function getPosition(options: PositionOptions): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    try {
      navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), options);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Ask the browser for a coarse point (this is what shows the browser's own prompt the first time).
 * Call it only from a tap: <LocationAsk/>'s "Share location" or the Settings switch.
 * Stores the point and the "on" choice on success; returns null on a no, a timeout or no GPS.
 * A browser "no" is remembered as "off", so nothing asks again.
 */
export async function requestLocation(): Promise<ApproxLocation | null> {
  const pos = await getPosition({ enableHighAccuracy: false, timeout: 15_000, maximumAge: LOCATION_FRESH_MS });
  if (!pos) {
    writeChoice("off");
    emit();
    return null;
  }
  writeChoice("on");
  const point = store(pos.coords.latitude, pos.coords.longitude);
  emit();
  return point;
}

/** Remember "Not now" at the one ask: no point is read and nothing asks again. */
export function declineLocation(): void {
  writeChoice("off");
  clearStored();
  emit();
}

/**
 * The Settings switch. On: asks (or re-asks) the browser and stores a point; resolves to the point
 * or null if the browser said no. Off: forgets the stored point at once and stops silent refreshes.
 */
export async function setLocationEnabled(on: boolean): Promise<ApproxLocation | null> {
  if (on) return requestLocation();
  declineLocation();
  return null;
}

/** "granted" | "denied" | "prompt" | "unknown" (no Permissions API, as on older Safari). */
export async function locationPermission(): Promise<PermissionState | "unknown"> {
  try {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return "unknown";
    const status = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    return status.state;
  } catch {
    return "unknown";
  }
}

/**
 * Refresh the stored point with no UI, only when the person said yes AND the browser reports the
 * permission as already granted (so this can never show a prompt). Skips a point younger than
 * LOCATION_FRESH_MS unless `force`. Returns the (possibly unchanged) stored point.
 * `allowUnasked`: also when the one ask was never answered here (only for the person's own request
 * for places, see locationForRequest); the read then counts as their yes.
 */
export async function refreshLocationSilently(force = false, allowUnasked = false): Promise<ApproxLocation | null> {
  const current = readStoredLocation();
  const choice = readLocationChoice();
  // "Off" in the app always wins, even when the browser would allow it.
  if (choice === "off" || (choice === null && !allowUnasked)) return current;
  if (!force && current && Date.now() - current.at < LOCATION_FRESH_MS) return current;
  if ((await locationPermission()) !== "granted") return current;
  const pos = await getPosition({ enableHighAccuracy: false, timeout: 15_000, maximumAge: LOCATION_FRESH_MS });
  if (!pos) return current;
  if (choice !== "on") writeChoice("on");
  const point = store(pos.coords.latitude, pos.coords.longitude);
  emit();
  return point;
}

/**
 * The coarse point to send with THIS person's own request for places (group /plan, @Larry). The
 * stored point if there is one; otherwise a silent read when the browser already allows it (never a
 * prompt), also for someone who never saw the one ask here (a QR join, another tab), but never after
 * "off" in the app. Only lat/lon, rounded to about 1 km. null = this phone truly has none.
 */
export async function locationForRequest(): Promise<{ lat: number; lon: number } | null> {
  const point = readStoredLocation() ?? (await refreshLocationSilently(true, true));
  return point ? { lat: coarsen(point.lat), lon: coarsen(point.lon) } : null;
}

/**
 * A fresh precise fix for check-in Arrive/Leave and Open to meet, read at the tap. Never stored here:
 * send it to the server, which checks it and throws it away. Returns null if the phone can't say.
 */
export async function getPreciseFix(): Promise<PreciseFix | null> {
  const pos = await getPosition({ enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 });
  if (!pos) return null;
  return { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy };
}

// ---- The hook ---------------------------------------------------------------------------------

interface Snapshot {
  location: ApproxLocation | null;
  choice: LocationChoice;
}

let cached: Snapshot = { location: null, choice: null };
let cachedKey = "";
const SERVER_SNAPSHOT: Snapshot = { location: null, choice: null };

function getSnapshot(): Snapshot {
  const location = readStoredLocation();
  const choice = readLocationChoice();
  const key = `${location?.lat}|${location?.lon}|${location?.at}|${choice}`;
  if (key !== cachedKey) {
    cachedKey = key;
    cached = { location, choice };
  }
  return cached;
}

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === LOCATION_KEY || e.key === LOCATION_CHOICE_KEY || e.key === null) cb();
  };
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

export interface ApproxLocationState {
  /** The stored coarse point, or null (off, never asked, or not read yet). */
  location: ApproxLocation | null;
  /** "on" | "off" | null (never asked). */
  choice: LocationChoice;
  /** Shorthand: true when there is a point to search near. */
  on: boolean;
}

/**
 * The stored coarse point for screens that list places (pair, room, /larry, /steps). Never prompts:
 * on mount it refreshes silently only if the permission is already granted. With `location` null,
 * show LOCATION_OFF_LINE (never a "Share location" button: D24).
 */
export function useApproxLocation(): ApproxLocationState {
  const snap = React.useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT);
  React.useEffect(() => {
    void refreshLocationSilently();
  }, []);
  return { location: snap.location, choice: snap.choice, on: snap.location !== null };
}
