"use client";

// The browser side of Open to meet: a random device id for this phone, and calls to /api/meet/**
// through apiFetch (it sends the signed-in account's ID token; Open to meet is for 18+ accounts).
// The visit's session id lives only in the page's memory: closing or leaving the page switches
// Open to meet off.
import type { RoomCredentials } from "@/lib/contracts";
import { apiFetch } from "@/lib/api-client";
import type { TasteItem } from "@/lib/types";
import type { ReportReason } from "./config";
import { type Where, WHERE_HEADER, whereHeaderValue } from "./presence";

const DEVICE_KEY = "larry.device";

/** A random id for this phone, made once. Only its HMAC is stored on the server (for Block). */
export function deviceId(): string {
  try {
    const have = localStorage.getItem(DEVICE_KEY);
    if (have && /^[\w-]{8,100}$/.test(have)) return have;
    const made = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, made);
    return made;
  } catch {
    // Storage blocked: a new id each time, which only makes blocks rely on picks.
    return crypto.randomUUID();
  }
}

export class MeetApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await apiFetch(url, {
      ...init,
      headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers as Record<string, string>) },
      cache: "no-store",
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new MeetApiError("Looks like you're offline. Try again once you're connected.", 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new MeetApiError(body?.error ?? "Hmm, that didn't go through. Try again in a moment?", res.status);
  return body as T;
}

const post = <T>(url: string, body: unknown) => call<T>(url, { method: "POST", body: JSON.stringify(body) });
const path = (placeId: string) => `/api/meet/${encodeURIComponent(placeId)}`;

/** An anonymous count per shared thing ("2 people here like Ghibli"). Never one person. */
export interface NearbyGroup {
  groupId: string;
  kind: "pick" | "bridge";
  thing: string;
  count: number;
  line: string;
  /** Larry's line about the shared thing, and the same in plain words. */
  witty?: { line: string; plain: string };
  waved: boolean;
}

export interface NearbyResult {
  venue: { name: string };
  expiresAt: number;
  groups: NearbyGroup[];
  matches: { roomCode: string; credentials: RoomCredentials }[];
}

/**
 * Where this phone is now, to show the server it is at the venue. Sent with every open, poll and
 * wave; the server checks it and throws it away. Throws a MeetApiError with a plain message.
 */
export function currentWhere(maxAgeMs = 30_000): Promise<Where> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new MeetApiError("This phone can't share its location, so Open to meet can't check you are here.", 0));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
      (err) =>
        reject(
          new MeetApiError(
            err.code === err.PERMISSION_DENIED
              ? "Open to meet needs your location to check you are here. Allow location for this page, then try again."
              : "We couldn't get your location. Step near a window or the door, then try again.",
            0,
          ),
        ),
      { enableHighAccuracy: true, maximumAge: maxAgeMs, timeout: 15_000 },
    );
  });
}

export const getVenue = (placeId: string, signal?: AbortSignal) => call<{ venue: { name: string } }>(path(placeId), { signal });

export const openMeet = (placeId: string, persona: { name: string; likes: TasteItem[] }, where: Where, visitToken: string) =>
  post<{ sessionId: string; expiresAt: number }>(`${path(placeId)}/open`, { deviceId: deviceId(), persona, adult: true, where, visitToken });

export const getNearby = (placeId: string, sessionId: string, where: Where, signal?: AbortSignal) =>
  call<NearbyResult>(path(placeId), { signal, headers: { "x-meet-session": sessionId, [WHERE_HEADER]: whereHeaderValue(where) } });

export const waveAt = (placeId: string, sessionId: string, groupId: string, where: Where) =>
  post<{ mutual: false; already?: true } | { mutual: true; roomCode: string; credentials: RoomCredentials }>(`${path(placeId)}/wave`, {
    sessionId,
    groupId,
    where,
  });

export const closeMeet = (placeId: string, sessionId: string) => post<{ ok: true }>(`${path(placeId)}/close`, { sessionId });

/** Switches off as the page goes away (tab closed, navigated off). Works even while unloading. */
export function closeOnLeave(placeId: string, sessionId: string) {
  const body = new Blob([JSON.stringify({ sessionId })], { type: "application/json" });
  if (!navigator.sendBeacon?.(`${path(placeId)}/close`, body)) {
    void fetch(`${path(placeId)}/close`, { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" } }).catch(() => {});
  }
}

/** Who to block or report: everyone in a group of the nearby list, or someone in a room. */
export type SafetyTarget =
  | { sessionId: string; groupId: string }
  | { room: RoomCredentials; targetMemberId: string };

export const blockPerson = (t: SafetyTarget) =>
  post<{ ok: true }>("/api/meet/block", "room" in t ? { ...t, deviceId: deviceId() } : t);

export const reportPerson = (t: SafetyTarget, reason: ReportReason, note?: string) =>
  post<{ ok: true }>("/api/meet/report", { ...("room" in t ? { ...t, deviceId: deviceId() } : t), reason, ...(note ? { note } : {}) });
