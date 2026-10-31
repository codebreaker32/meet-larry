"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Loader2, Sparkles } from "lucide-react";
import { buttonStyles } from "@/components/link-button";
import type { FitPeople } from "@/components/place-card";
import { PlanTicketView } from "@/components/plan-ticket";
import { StepKindPill } from "@/components/step-kind";
import { Button, Dialog, Skeleton } from "@/components/ui";
import { APP_NAME } from "@/lib/brand";
import type { PlanTicket } from "@/lib/contracts";
import type { FirstStep } from "@/lib/types";
import { cn } from "@/lib/utils";

export type DraftStep = Omit<FirstStep, "id" | "createdAt" | "done">;

/**
 * "Finish": the room's way out to the real world. Larry's group First Steps first, each one saved
 * to this phone with its own Save button (one way to save, no second button doing the same). With none yet, one tap asks Larry to pick a plan for the group, and
 * a few fixed ideas from the common ground are ready as a fallback.
 */
export function FinishDialog({
  open,
  onOpenChange,
  ticket,
  people,
  withPerson,
  steps,
  fallback,
  ideasLoading,
  isSaved,
  onSave,
  onAskLarry,
  larryBusy,
  canAskLarry,
  larryAway = false,
  onLeave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The group's Plan Ticket (Larry's, or built from the place someone chose). Leads the dialog. */
  ticket?: PlanTicket | null;
  people?: FitPeople;
  /** The others in the room: the saved plan is "with" them. */
  withPerson?: string;
  steps: DraftStep[];
  fallback: DraftStep[];
  /** True while fresh AI-written ideas are on their way. */
  ideasLoading?: boolean;
  isSaved: (s: DraftStep) => boolean;
  onSave: (steps: DraftStep[]) => void;
  onAskLarry: () => void;
  larryBusy: boolean;
  canAskLarry: boolean;
  /** Larry is excused: it can't be asked until someone says hello. */
  larryAway?: boolean;
  onLeave: () => void;
}) {
  const blocked = larryBusy || larryAway || !canAskLarry;
  const fromLarry = steps.length > 0;
  const list = fromLarry ? steps : ideasLoading ? [] : fallback;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title="One real thing to do together"
      description={
        ticket
          ? undefined
          : fromLarry
            ? `${APP_NAME} picked ${steps.length === 1 ? "this" : "these"} from what you all like.`
            : `${APP_NAME} hasn't picked a group step yet.`
      }
    >
      {ticket && (
        <div>
          <PlanTicketView
            key={ticket.place.id}
            ticket={ticket}
            people={people}
            withPerson={withPerson}
            variant="dialog"
            afterSave="close"
            onDone={() => onOpenChange(false)}
          />
          {list.length > 0 && <h3 className="mt-6 font-bold">Or a smaller step</h3>}
        </div>
      )}

      {!fromLarry && !ticket && (
        <div className="rounded-mini bg-table p-3">
          <Button
            loading={larryBusy}
            disabled={blocked}
            icon={<Sparkles />}
            onClick={() => {
              onOpenChange(false);
              onAskLarry();
            }}
            className="w-full"
          >
            Ask {APP_NAME} for a group plan
          </Button>
          <p className="mt-2 text-label text-ink-soft">
            {larryAway
              ? `${APP_NAME} stepped out. Tap Hello ${APP_NAME} first.`
              : larryBusy
                ? `${APP_NAME} is busy. Try again in a moment.`
                : `${APP_NAME} looks at your common ground and nearby ideas.`}
          </p>
        </div>
      )}

      {!fromLarry && ideasLoading && !ticket && (
        <>
          <h3 className="mt-5 font-bold">Or pick one of these</h3>
          <p role="status" className="mt-2 flex items-center gap-2 text-ink-soft">
            <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden /> {APP_NAME} is writing ideas from your common ground…
          </p>
          <ul className="mt-3 flex flex-col gap-2" aria-hidden>
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex h-[4.5rem] items-center gap-3 rounded-mini border-2 border-line bg-paper p-3">
                <Skeleton shape="circle" className="size-10" />
                <Skeleton className="flex-1" />
              </li>
            ))}
          </ul>
        </>
      )}

      {list.length > 0 && (
        <>
          {!fromLarry && !ticket && <h3 className="mt-5 font-bold">Or pick one of these</h3>}
          <ul className="mt-3 flex flex-col gap-2">
            {list.map((s) => {
              const saved = isSaved(s);
              return (
                <li key={s.kind + s.text} className={cn("flex items-center gap-3 rounded-mini border-2 bg-paper p-3", saved ? "border-cat-film" : "border-border-subtle")}>
                  <StepKindPill kind={s.kind} variant="compact" />
                  <p className="min-w-0 flex-1 font-bold leading-snug">
                    {s.text}
                    {s.withPerson && <span className="block text-label font-normal text-ink-soft">With {s.withPerson}.</span>}
                  </p>
                  {/* One way to save: this button. Once saved, it becomes plain text. */}
                  {saved ? (
                    <p className="flex min-h-12 shrink-0 items-center gap-1.5 px-1 text-label font-bold">
                      <Check className="size-4" aria-hidden /> Saved
                    </p>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onSave([s])}
                      aria-label={`Save: ${s.text}`}
                      className="shrink-0 px-3 sm:px-4"
                    >
                      Save
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Link href="/steps" className={buttonStyles.secondary}>
          See my First Steps
        </Link>
        <Button variant="quiet" onClick={onLeave}>
          Leave the room
        </Button>
      </div>
    </Dialog>
  );
}

/** "Leave this chat?": Stay has first focus, so a stray Enter never throws the chat away. */
export function LeaveDialog({
  open,
  onOpenChange,
  unsaved,
  onLeave,
  leaving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unsaved: number;
  onLeave: () => void;
  leaving: boolean;
}) {
  const stayRef = React.useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      initialFocus={stayRef}
      title="Leave this chat?"
      description={
        <>
          The others can keep talking. The chat is not saved on this phone.
          {unsaved > 0 && ` ${unsaved === 1 ? "A group First Step is" : "Some group First Steps are"} not saved yet.`}
        </>
      }
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button ref={stayRef} size="sm" onClick={() => onOpenChange(false)}>
          Stay
        </Button>
        <Button variant="quiet" loading={leaving} onClick={onLeave}>
          Leave
        </Button>
      </div>
    </Dialog>
  );
}
