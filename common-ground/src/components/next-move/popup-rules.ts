// When Larry's next move pops up on home, and what "Something smaller" offers. Pure, so it is tested
// without a browser. The popup is only for signed-in people with a taste card (user decision,
// 31 Oct): visitors and device-only people never see it.
import { nextMove, type HomeState } from "@/lib/next-move";
import type { NextMove } from "@/lib/types/next-move";

/** The local day the popup last opened by itself (a date only, nothing else). */
export const POPUP_SHOWN_KEY = "larry.nextmove.shownOn";

/** The device's own calendar day, e.g. "2026-10-31". */
export function localDayKey(now: Date): string {
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

/** A real next step: a move exists and it isn't "make a card" (the popup needs a card anyway). */
export function isRealMove(move: NextMove | null | undefined): move is NextMove {
  return !!move && move.kind !== "make-card";
}

/** Opens by itself at most once a day, and only for a signed-in person with a card and a real step. */
export function shouldAutoOpen(opts: { signedIn: boolean; hasCard: boolean; move: NextMove | null | undefined; shownOn: unknown; now: Date }): boolean {
  if (!opts.signedIn || !opts.hasCard || !isRealMove(opts.move)) return false;
  return opts.shownOn !== localDayKey(opts.now);
}

/** Kinds where "Not now" is remembered for the back-off (a plan already made or a visit underway is never counted). */
export const SKIPPABLE = new Set<NextMove["kind"]>(["fingerprint", "second-person", "warm-up", "open-to-meet", "plan", "weekly"]);

/**
 * The smaller step Larry would offer after two skips of this move, or null when there is none
 * (a check-in, a plan reminder or the fingerprint come first and never shrink; a smaller step
 * is already as small as it gets). Uses the same pure nextMove(), so it never invents a step.
 */
export function smallerMove(state: HomeState, move: NextMove, now: Date): NextMove | null {
  if (move.backOff || !SKIPPABLE.has(move.kind)) return null;
  const s = nextMove({ ...state, ignoredMoves: [move.kind, move.kind] }, now);
  return s.backOff ? s : null;
}
