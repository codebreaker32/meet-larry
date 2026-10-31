"use client";

import * as React from "react";
import { LifeBuoy } from "lucide-react";
import { HelpDialog, type HelpHandle } from "@/components/chat/help-dialog";
import { LarryAvatar } from "@/components/larry-avatar";
import { Dialog } from "@/components/ui";
import { APP_NAME } from "@/lib/brand";
import { nextMove } from "@/lib/next-move";
import { readStored, writeStored } from "@/lib/storage";
import type { NextMove } from "@/lib/types/next-move";
import { NextMoveView } from "./next-move-card";
import { isRealMove, localDayKey, POPUP_SHOWN_KEY, shouldAutoOpen, SKIPPABLE, smallerMove } from "./popup-rules";
import { skipMove, tookMove, useHomeState } from "./use-home-state";

const EPOCH = new Date(0);
let visitClock: Date | null = null;
const readVisitClock = () => (visitClock ??= new Date());
const noServerClock = () => null;
const noSubscribe = () => () => {};

// Phones: a bottom sheet (full width, flat bottom). Wider screens: the centred card the Dialog
// already is. It rises in only when motion is allowed; globals.css also clamps it under reduced motion.
const SHEET =
  "max-sm:mb-0 max-sm:w-full max-sm:max-w-full max-sm:rounded-b-none max-sm:border-b-0 " +
  "motion-safe:transition-transform motion-safe:duration-(--dur-base) motion-safe:ease-deal motion-safe:starting:translate-y-6 max-sm:motion-safe:starting:translate-y-full";

const pill =
  "press press-hard inline-flex min-h-12 items-center gap-2 rounded-full border-2 border-ink bg-paper py-1 pl-1 pr-4 font-bold text-ink hover:bg-table";

/**
 * Larry's next move as a popup over home (user decision, 31 Oct): a small "Larry's next move" pill
 * with the avatar, and a labelled dialog that opens by itself at most once a day when there is a
 * real next step. Mount it only for a signed-in person; it renders nothing without a card or a step.
 */
export function NextMovePopup({ signedIn, className }: { signedIn: boolean; className?: string }) {
  // One clock read per visit, so the move doesn't change while someone reads it (device only).
  const clock = React.useSyncExternalStore(noSubscribe, readVisitClock, noServerClock);
  const now = clock ?? EPOCH;
  const state = useHomeState(now);
  const move = React.useMemo(() => (state ? nextMove(state, now) : null), [state, now]);

  const [open, setOpen] = React.useState(false);
  const [smaller, setSmaller] = React.useState<NextMove | null>(null);
  const [announce, setAnnounce] = React.useState("");
  const [autoChecked, setAutoChecked] = React.useState(false);
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const helpRef = React.useRef<HelpHandle>(null);

  const hasCard = !!state?.hasCard;
  const ready = !!clock && !!state && signedIn && hasCard && isRealMove(move);

  // Once the device and the account are read: open by itself, at most once a day. Decided once per
  // visit while rendering (no effect round trip), from the day it last opened.
  if (ready && !autoChecked && clock) {
    setAutoChecked(true);
    if (shouldAutoOpen({ signedIn, hasCard, move, shownOn: readStored<unknown>(POPUP_SHOWN_KEY, null), now: clock })) setOpen(true);
  }
  // Any opening counts as today's, so it never opens by itself again the same day.
  React.useEffect(() => {
    if (open && clock) writeStored(POPUP_SHOWN_KEY, localDayKey(clock));
  }, [open, clock]);

  // After "Something smaller", the new step's heading takes focus (the button it replaced is gone).
  React.useEffect(() => {
    if (smaller && open) headingRef.current?.focus();
  }, [smaller, open]);

  if (!ready || !state || !move) return null;
  const shown = smaller ?? move;
  const offer = smaller ? null : smallerMove(state, move, now);

  const close = () => setOpen(false);
  const notNow = () => {
    if (SKIPPABLE.has(shown.kind) && !shown.backOff) skipMove(shown.kind);
    setOpen(false);
    setAnnounce(`Okay. ${APP_NAME} will suggest something else next time.`);
  };

  return (
    <div className={className}>
      <div role="status" aria-live="polite" className="sr-only">
        {announce}
      </div>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => {
          setAnnounce("");
          setOpen(true);
        }}
        className={pill}
        data-testid="next-move-pill"
      >
        <LarryAvatar size="md" decorative />
        {APP_NAME}&apos;s next move
      </button>

      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`${APP_NAME}'s next move`}
        icon={<LarryAvatar size="sm" decorative />}
        size="md"
        className={SHEET}
      >
        <NextMoveView
          variant="sheet"
          move={shown}
          state={state}
          headingRef={headingRef}
          onTake={() => {
            tookMove();
            close();
          }}
          onSmaller={
            offer
              ? () => {
                  // Picking smaller counts as passing on the bigger step once, so Larry learns the size.
                  skipMove(move.kind);
                  setSmaller(offer);
                }
              : undefined
          }
          onSkip={notNow}
        />
        {/* Help is never hidden behind the popup: it opens on top of it. */}
        <p className="mt-5 border-t-2 border-line pt-3">
          <button
            type="button"
            onClick={() => helpRef.current?.open()}
            className="press press-flat -ml-1 inline-flex min-h-12 items-center gap-2 rounded-full px-1 pr-3 font-bold text-ink underline decoration-cat-film decoration-[3px] underline-offset-4 hover:bg-table"
          >
            <LifeBuoy className="size-5" aria-hidden /> Need help now?
          </button>
        </p>
      </Dialog>
      {/* A sibling, not a child, so its Escape and close never reach the popup. */}
      <HelpDialog ref={helpRef} />
    </div>
  );
}
