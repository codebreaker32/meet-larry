// Browser side of access codes: the code is entered once and remembered on this device
// (localStorage), and apiFetch sends it with every request in the x-larry-code header. When an AI
// route answers 401/402, apiFetch tells the page (an "larry:access" event) so the access-code
// prompt can open. When this device is signed in, it also sends `Authorization: Bearer <ID token>`. Routes that need no AI ignore the header, so everything else keeps working.
import { useSyncExternalStore } from "react";
import { ACCESS_HEADER, type AccessState, CODE_HEADER, normalizeAccessCode } from "./access/shared";

export const ACCESS_CODE_KEY = "larry.accessCode";
/** Fired on window when an AI route turned a request away. detail: AccessNeeded. */
export const ACCESS_EVENT = "larry:access";
/** Fired on window after a code is saved, so a page can offer to try again. */
export const ACCESS_SAVED_EVENT = "larry:access-saved";

export interface AccessNeeded {
  state: AccessState;
}

/** The last turn-away not yet shown (the prompt may mount after the first request answers). */
let unseenAccess: { state: AccessState; at: number } | null = null;
/** Takes the turn-away that fired in the last few seconds before the prompt was listening, if any. */
export function takeUnseenAccess(now = Date.now()): AccessState | null {
  const u = unseenAccess;
  unseenAccess = null;
  return u && now - u.at < 10_000 ? u.state : null;
}

const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

/** The saved code, or null. Null on the server and when storage is blocked. */
export function getAccessCode(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return normalizeAccessCode(localStorage.getItem(ACCESS_CODE_KEY));
  } catch {
    return null;
  }
}

export function saveAccessCode(code: string) {
  const clean = normalizeAccessCode(code);
  if (!clean) return;
  try {
    localStorage.setItem(ACCESS_CODE_KEY, clean);
  } catch {
    // Private mode with storage blocked: the code works until the tab closes, not after.
  }
  listeners.forEach((l) => l());
  window.dispatchEvent(new Event(ACCESS_SAVED_EVENT));
}

export function clearAccessCode() {
  try {
    localStorage.removeItem(ACCESS_CODE_KEY);
  } catch {}
  listeners.forEach((l) => l());
}

/** The saved code; `undefined` while rendering on the server (not loaded yet). */
export function useAccessCode(): string | null | undefined {
  return useSyncExternalStore(subscribe, getAccessCode, () => undefined);
}

/** True for an answer that means "this needs a (different) access code". */
export function accessStateOf(res: Response): AccessState | null {
  if (res.status !== 401 && res.status !== 402) return null;
  const s = res.headers.get(ACCESS_HEADER);
  return s === "missing" || s === "invalid" || s === "spent" ? s : null;
}

/**
 * fetch with the saved access code in the x-larry-code header. The response comes back as it is;
 * on a 401/402 from an AI route it also fires ACCESS_EVENT so the prompt can open.
 */
export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  const code = getAccessCode();
  if (code && !headers.has(CODE_HEADER)) headers.set(CODE_HEADER, code);
  // Signed in: send the Firebase ID token too, so AI routes charge this person's own Larry time
  // (acct:<uid>) and check-ins can add account Glory. Signed out: no SDK is loaded, nothing is sent.
  if (typeof window !== "undefined" && !headers.has("authorization")) {
    try {
      const { authHeader } = await import("@/lib/firebase/client");
      for (const [k, v] of Object.entries(await authHeader())) headers.set(k, v);
    } catch {
      // Sign-in not available on this build: the access code still works.
    }
  }
  const res = await fetch(input, { ...init, headers });
  const state = accessStateOf(res);
  if (state && typeof window !== "undefined") {
    unseenAccess = { state, at: Date.now() };
    window.dispatchEvent(new CustomEvent<AccessNeeded>(ACCESS_EVENT, { detail: { state } }));
  }
  return res;
}
