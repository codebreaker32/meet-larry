import { HAPTIC } from "@/lib/tokens";

/**
 * Light haptics on phones that support them (navigator.vibrate: Android Chrome, most Android
 * browsers; iOS Safari has no Vibration API, so it is a no-op there).
 *
 * - `tick()`: one short tap for a primary action. The Button primitive calls it for its primary
 *   variant (opt out with `haptic={false}`). Never wire it to every tap.
 * - `success()`: a tap, pause, firmer tap for the big moments only: a check-in counted, a Glory gain,
 *   a group formed.
 *
 * Both are silent under `prefers-reduced-motion: reduce`, on the server, without the API, and when
 * the browser refuses (no user activation yet, or the page is hidden). A tick is also dropped if one
 * played in the last 250ms, so a double tap never buzzes twice.
 */

const TICK_GAP_MS = 250;
let lastTick = 0;

function allowed(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  if (typeof navigator.vibrate !== "function") return false;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return false;
  try {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
  } catch {
    // An odd embedded browser without matchMedia: assume motion is fine.
  }
  return true;
}

function vibrate(pattern: number | readonly number[]): boolean {
  if (!allowed()) return false;
  try {
    return navigator.vibrate(typeof pattern === "number" ? pattern : [...pattern]);
  } catch {
    return false;
  }
}

/** One short tap under the finger, for a primary action. */
export function tick(): boolean {
  const now = Date.now();
  if (now - lastTick < TICK_GAP_MS) return false;
  const played = vibrate(HAPTIC.tick);
  if (played) lastTick = now;
  return played;
}

/** Tap, pause, firmer tap: a check-in counted, Glory gained, a group formed. */
export function success(): boolean {
  return vibrate(HAPTIC.success);
}
