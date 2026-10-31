// Browser side of phone sign-in (Firebase Authentication, SMS code). The SDK loads only when it is
// needed: on the sign-in page, or when this device signed in before. A signed-out visitor never
// downloads it. No Analytics, no client Firestore (the rules deny it; data goes through our API).
//
// Playwright (NEXT_PUBLIC_E2E=1) gets a fake instead: any phone number, code 123456, and an
// `e2e:<uid>` token that the server accepts only with E2E=1 outside production.
import type { Auth, ConfirmationResult, User } from "firebase/auth";
import { STORAGE_KEYS } from "@/lib/types/storage-keys";
import { E2E_AUTH, E2E_TOKEN_PREFIX, firebaseWebConfig } from "./config";

/** Set while this device is signed in, so pages know to load the SDK. Holds no token or number. */
export const SIGNED_IN_HINT_KEY = STORAGE_KEYS.authSignedIn;
/** E2E only: the fake signed-in uid. */
const E2E_UID_KEY = "larry.e2e.uid";
/** E2E only: the code the fake accepts. */
export const E2E_OTP = "123456";

/** Fired on window after this tab signs in or out, so the account state can reload. */
export const AUTH_CHANGED_EVENT = "larry:auth-changed";
const announce = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
};

export type AuthUser = { uid: string };
type Listener = (user: AuthUser | null) => void;

/** True when phone sign-in can work on this build. */
export const signInAvailable = () => E2E_AUTH || firebaseWebConfig() !== null;

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {}
};

/** True when this device may be signed in (worth loading the SDK to find out). */
export const maybeSignedIn = () => (E2E_AUTH ? !!read(E2E_UID_KEY) : read(SIGNED_IN_HINT_KEY) === "1");

/* ---------------------------------------------------------------- the real SDK, loaded lazily */

let loaded: Promise<{ auth: Auth; mod: typeof import("firebase/auth") }> | null = null;

function loadAuth() {
  loaded ??= (async () => {
    const config = firebaseWebConfig();
    if (!config) throw new Error("Phone sign-in is not set up on this build.");
    const [{ getApps, initializeApp }, mod] = await Promise.all([import("firebase/app"), import("firebase/auth")]);
    const app = getApps()[0] ?? initializeApp(config);
    const auth = mod.getAuth(app);
    auth.languageCode = "en";
    return { auth, mod };
  })();
  loaded.catch(() => (loaded = null));
  return loaded;
}

/* ---------------------------------------------------------------- the e2e fake */

const e2eListeners = new Set<Listener>();
const e2eUser = (): AuthUser | null => {
  const uid = read(E2E_UID_KEY);
  return uid ? { uid } : null;
};
const e2eEmit = () => e2eListeners.forEach((l) => l(e2eUser()));

/* ---------------------------------------------------------------- public API */

/**
 * Calls `listener` with the signed-in user now and whenever it changes (sign in, sign out, token
 * refresh). Returns an unsubscribe function. Loads the SDK only when `load` is true.
 */
export function watchAuth(listener: Listener, load = maybeSignedIn()): () => void {
  if (E2E_AUTH) {
    e2eListeners.add(listener);
    listener(e2eUser());
    return () => e2eListeners.delete(listener);
  }
  if (!load || !firebaseWebConfig()) {
    listener(null);
    return () => {};
  }
  let stop: (() => void) | null = null;
  let cancelled = false;
  loadAuth()
    .then(({ auth, mod }) => {
      if (cancelled) return;
      stop = mod.onIdTokenChanged(auth, (u: User | null) => {
        write(SIGNED_IN_HINT_KEY, u ? "1" : null);
        listener(u ? { uid: u.uid } : null);
      });
    })
    .catch(() => listener(null));
  return () => {
    cancelled = true;
    stop?.();
  };
}

/** A fresh ID token for the Authorization header, or null when signed out. Never logged. */
export async function currentIdToken(): Promise<string | null> {
  if (E2E_AUTH) {
    const u = e2eUser();
    return u ? `${E2E_TOKEN_PREFIX}${u.uid}` : null;
  }
  if (!maybeSignedIn() || !firebaseWebConfig()) return null;
  try {
    const { auth } = await loadAuth();
    await auth.authStateReady();
    return (await auth.currentUser?.getIdToken()) ?? null;
  } catch {
    return null;
  }
}

/** `{ Authorization: "Bearer …" }` when signed in, else `{}`. */
export async function authHeader(): Promise<Record<string, string>> {
  const t = await currentIdToken();
  return t ? { authorization: `Bearer ${t}` } : {};
}

/** fetch with the ID token attached when signed in. */
export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(await authHeader())) if (!headers.has(k)) headers.set(k, v);
  return fetch(input, { ...init, headers });
}

/** Why a sign-in step failed, in words for the screen. */
export type SignInError = "bad-number" | "bad-code" | "too-many" | "expired" | "network" | "unavailable";

export class PhoneSignInError extends Error {
  constructor(readonly reason: SignInError) {
    super(reason);
    this.name = "PhoneSignInError";
  }
}

function reasonOf(err: unknown): SignInError {
  const code = (err as { code?: string })?.code ?? "";
  if (code.includes("invalid-phone-number") || code.includes("missing-phone-number")) return "bad-number";
  if (code.includes("invalid-verification-code") || code.includes("missing-verification-code")) return "bad-code";
  if (code.includes("code-expired") || code.includes("session-expired")) return "expired";
  if (code.includes("too-many-requests") || code.includes("quota-exceeded")) return "too-many";
  if (code.includes("network-request-failed")) return "network";
  return "unavailable";
}

/** "98765 43210" -> "+919876543210"; "+1 555..." stays international. Null when it can't be a number. */
export function toE164(raw: string, defaultCountry = "+91"): string | null {
  const t = raw.trim();
  const digits = t.replace(/[^\d]/g, "");
  if (t.startsWith("+")) return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
  const local = digits.replace(/^0+/, "");
  return /^[6-9]\d{9}$/.test(local) ? `${defaultCountry}${local}` : null;
}

export interface PendingSignIn {
  /** Checks the 6-digit code; resolves once signed in. Throws PhoneSignInError. */
  confirm(code: string): Promise<AuthUser>;
}

/**
 * Sends the SMS code to `phone` (E.164). `recaptchaHost` is an empty element the invisible
 * reCAPTCHA can attach to. Throws PhoneSignInError.
 */
export async function sendSignInCode(phone: string, recaptchaHost: HTMLElement): Promise<PendingSignIn> {
  if (E2E_AUTH) {
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new PhoneSignInError("bad-number");
    return {
      async confirm(code) {
        if (code !== E2E_OTP) throw new PhoneSignInError("bad-code");
        const uid = `e2e-${phone.replace(/\D/g, "")}`;
        write(E2E_UID_KEY, uid);
        e2eEmit();
        announce();
        return { uid };
      },
    };
  }
  let result: ConfirmationResult;
  try {
    const { auth, mod } = await loadAuth();
    // A fresh child each time: a verifier can't be rendered twice into the same element.
    recaptchaHost.replaceChildren();
    const slot = document.createElement("div");
    recaptchaHost.append(slot);
    const verifier = new mod.RecaptchaVerifier(auth, slot, { size: "invisible" });
    try {
      result = await mod.signInWithPhoneNumber(auth, phone, verifier);
    } finally {
      // The verifier is single use; the confirmation keeps what it needs.
      setTimeout(() => verifier.clear(), 0);
    }
  } catch (err) {
    throw err instanceof PhoneSignInError ? err : new PhoneSignInError(reasonOf(err));
  }
  return {
    async confirm(code) {
      try {
        const cred = await result.confirm(code);
        write(SIGNED_IN_HINT_KEY, "1");
        announce();
        return { uid: cred.user.uid };
      } catch (err) {
        throw new PhoneSignInError(reasonOf(err));
      }
    },
  };
}

/** Signs this device out. */
export async function signOutHere(): Promise<void> {
  if (E2E_AUTH) {
    write(E2E_UID_KEY, null);
    e2eEmit();
    announce();
    return;
  }
  write(SIGNED_IN_HINT_KEY, null);
  if (firebaseWebConfig()) {
    try {
      const { auth, mod } = await loadAuth();
      await mod.signOut(auth);
    } catch {}
  }
  announce();
}
