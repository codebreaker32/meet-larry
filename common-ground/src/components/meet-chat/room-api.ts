"use client";

// The browser side of the rooms HTTP API (see src/lib/contracts.ts), plus the room code helpers
// and the per-room credentials this device keeps so it can post as its member.
import { useMemo, useSyncExternalStore } from "react";
import { apiFetch } from "@/lib/api-client";
import { recentPlacesField, signalsField } from "@/lib/mood";
import { personaForRequest } from "@/lib/persona";
import type { Persona, PersonaUpdate, Room, RoomCredentials, RoomPreview } from "@/lib/contracts";

/** Shown before every code, so a code reads as Larry's: "LARRY-7KQ2MX". */
export const CODE_PREFIX = "LARRY-";
export const CODE_LENGTH = 6;
/** Rooms expire this long after the last change (server rule); older saved rooms are hidden. */
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const CRED_PREFIX = "larry.room.";

/** The symbols a room code uses (the server's CODE_ALPHABET): no 0, O, 1 or I, so none can be misread. */
export const CODE_SYMBOLS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/**
 * R3: what a person typed, cleaned the forgiving way. Any case, spaces and dashes are fine, the
 * "LARRY-" part is optional, a whole room link works, and O/0 and I/1 count as the same symbol
 * (both become the digit). Returns at most 6 symbols, so the field can show what is understood.
 */
export function cleanCodeInput(raw: string): string {
  let s = raw.trim();
  // A pasted link: keep the last path part.
  const fromLink = s.match(/\/room\/([^/?#\s]+)/i);
  if (fromLink) s = decodeURIComponent(fromLink[1]);
  s = s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.startsWith("LARRY")) s = s.slice(5);
  return s.replace(/O/g, "0").replace(/I/g, "1");
}

/** True when the typed code holds O, 0, I or 1: codes never use them, so the person can look again. */
export const hasLookalike = (raw: string): boolean => /[01]/.test(cleanCodeInput(raw));

/**
 * Accepts what a person might type or paste: "LARRY-7KQ2MX", "larry 7kq2mx", "7kq2mx", or a whole
 * room link. Returns the 6 symbols in capitals, or null when it can't be a room code.
 */
export function normalizeCode(raw: string): string | null {
  const s = cleanCodeInput(raw);
  return new RegExp(`^[${CODE_SYMBOLS}]{${CODE_LENGTH}}$`).test(s) ? s : null;
}

export const displayCode = (code: string) => `${CODE_PREFIX}${code}`;

/** "7KQ 2MX": read out and typed more easily in two halves. */
export const spacedCode = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`;

/* ---------- Credentials on this device ---------- */

interface StoredCredentials extends RoomCredentials {
  savedAt: number;
}

export function getCredentials(code: string): RoomCredentials | null {
  try {
    const raw = localStorage.getItem(CRED_PREFIX + code);
    if (!raw) return null;
    const c = JSON.parse(raw) as StoredCredentials;
    if (!c.memberId || !c.token) return null;
    return { code: c.code, memberId: c.memberId, token: c.token };
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
/** Calls back when this device joins or leaves a room (in this tab or another). */
export function subscribeCredentials(callback: () => void) {
  listeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

/** This device's credentials for a room: undefined while rendering on the server, null when not a member. */
export function useCredentials(code: string): RoomCredentials | null | undefined {
  const raw = useSyncExternalStore(
    subscribeCredentials,
    () => {
      const c = getCredentials(code);
      return c ? JSON.stringify(c) : "";
    },
    () => undefined,
  );
  return useMemo(() => (raw === undefined ? undefined : raw ? (JSON.parse(raw) as RoomCredentials) : null), [raw]);
}

export function saveCredentials(c: RoomCredentials) {
  const stored: StoredCredentials = { ...c, savedAt: Date.now() };
  localStorage.setItem(CRED_PREFIX + c.code, JSON.stringify(stored));
  notify();
}

/** Keeps a room on the "Your rooms" list while it is in use. */
export function touchCredentials(code: string) {
  const c = getCredentials(code);
  if (c) saveCredentials(c);
}

export function forgetCredentials(code: string) {
  localStorage.removeItem(CRED_PREFIX + code);
  notify();
}

/** Rooms this device is still in, newest first. Old ones (the server has dropped them) are cleared. */
export function savedRooms(): { code: string; savedAt: number }[] {
  const out: { code: string; savedAt: number }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(CRED_PREFIX)) continue;
    try {
      const c = JSON.parse(localStorage.getItem(key) ?? "") as StoredCredentials;
      if (Date.now() - c.savedAt < ROOM_TTL_MS) out.push({ code: c.code, savedAt: c.savedAt });
    } catch {
      /* skip a broken entry */
    }
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

/* ---------- HTTP ---------- */

export class RoomError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Easy-read words for each failure, whatever the server said. */
function messageFor(status: number, serverText?: string): string {
  if (status === 404) return "We couldn't find this room. The code may be wrong, or the room has ended.";
  if (status === 409) return "This room is full. A room has up to 5 people.";
  if (status === 429) return serverText ?? "Too many tries. Wait a moment, then try again.";
  if (status === 401 || status === 403) return "This phone isn't in the room any more.";
  return serverText ?? "Something went wrong. Try again.";
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    // apiFetch adds this phone's access code, which pays for Larry's replies.
    res = await apiFetch(url, {
      ...init,
      headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers as Record<string, string>) },
      cache: "no-store",
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new RoomError("No connection. Check your internet.", 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new RoomError(messageFor(res.status, body?.error), res.status);
  return body as T;
}

/**
 * For a member: the room, or { unchanged: true } when `since` is still its version. The
 * credentials go in headers (not the URL, so they stay out of logs) and tell the room this phone
 * is still here. A wrong or old member id answers 403.
 */
export function getRoom(code: string, since: number | undefined, signal: AbortSignal | undefined, creds: RoomCredentials) {
  const q = since === undefined ? "" : `?since=${since}`;
  return call<{ room: Room } | { unchanged: true }>(`/api/rooms/${code}${q}`, {
    signal,
    headers: { "x-member-id": creds.memberId, "x-member-token": creds.token },
  });
}

/** For the join screen: who is in the room and whether there is a seat. No chat, cards or places. */
export async function previewRoom(code: string, signal?: AbortSignal): Promise<RoomPreview> {
  const out = await call<{ preview: RoomPreview }>(`/api/rooms/${code}`, { signal });
  return out.preview;
}

export function postMessage(
  creds: RoomCredentials,
  text: string,
  toLarry: boolean,
  location?: { lat: number; lon: number },
  /** Typed while this phone showed Larry as excused: the server keeps it from Larry. */
  excused?: boolean,
  /** This phone's saved persona, sent only when Larry is asked, so it can use and grow it. */
  persona?: Persona | null,
) {
  return call<{ room: Room; crisis?: true; personaUpdate?: PersonaUpdate }>(`/api/rooms/${creds.code}/messages`, {
    method: "POST",
    body: JSON.stringify({
      memberId: creds.memberId,
      token: creds.token,
      text,
      toLarry,
      ...(excused ? { excused: true } : {}),
      ...(location ? { location } : {}),
      ...(persona && toLarry && !excused ? { persona: personaForRequest(persona) } : {}),
      // This phone's mood, age range and Hidden Gems, only when Larry is asked. The server blends
      // moods in counts and never shows anyone's signals to the room.
      ...(toLarry && !excused ? { ...signalsField(), ...recentPlacesField() } : {}),
    }),
  });
}

/** "Excuse Larry" (away) or "Hello Larry" (back), for the whole room. */
export function setLarryAway(creds: RoomCredentials, away: boolean) {
  return call<{ room: Room }>(`/api/rooms/${creds.code}/larry`, {
    method: "POST",
    body: JSON.stringify({ memberId: creds.memberId, token: creds.token, away }),
  });
}

/** Leaves the room on the server; this phone forgets the room once the server has answered. */
export async function leaveRoom(creds: RoomCredentials) {
  try {
    await call<{ ok: true }>(`/api/rooms/${creds.code}/leave`, {
      method: "POST",
      body: JSON.stringify({ memberId: creds.memberId, token: creds.token }),
    });
  } finally {
    forgetCredentials(creds.code);
  }
}
