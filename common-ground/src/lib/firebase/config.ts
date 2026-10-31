// Firebase web config for the Larry web app. Public by design: these values
// ship in the browser bundle. Read from NEXT_PUBLIC_FIREBASE_* (inlined at build time), so a build
// without them simply has no phone sign-in. No measurementId: the app does not use Analytics.

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  messagingSenderId?: string;
}

/** The web config, or null when it is not set (sign-in is then hidden). */
export function firebaseWebConfig(): FirebaseWebConfig | null {
  // Each name is written out in full so Next can inline it into the client bundle.
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;
  const messagingSenderId = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
  if (!apiKey || !authDomain || !projectId || !appId) return null;
  return { apiKey, authDomain, projectId, appId, ...(messagingSenderId ? { messagingSenderId } : {}) };
}

/**
 * The project the server verifies ID tokens for. No literal fallback: when neither value is set,
 * firebase-admin works the project out from its own credentials.
 */
export const FIREBASE_PROJECT_ID: string | undefined =
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || undefined;

/** True when the client uses the fake e2e phone sign-in (Playwright only). */
export const E2E_AUTH = process.env.NEXT_PUBLIC_E2E === "1";

/** Fake ID tokens the e2e sign-in hands out: `e2e:<uid>`. */
export const E2E_TOKEN_PREFIX = "e2e:";
