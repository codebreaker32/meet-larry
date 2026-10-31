"use client";

import * as React from "react";
import { Lock, MapPinCheck } from "lucide-react";
import { Button, Dialog, Stamp } from "@/components/ui";
import { buttonStyles } from "@/components/link-button";
import { nextStageLine, spotLine, type PlaceCounter } from "@/lib/checkins";
import { TITLES } from "@/lib/titles";
import { cn } from "@/lib/utils";

/**
 * The places collection (private, owner only): every place this person checked in at, with their
 * stage there, the Spot weeks count from 2 weeks up, and how close the next stage is. A place with
 * only unverified visits shows as "Visited" (D16). Nothing here is ever shown to anyone else.
 */
export function PlacesCollection({
  counters,
  onCheckIn,
  onForget,
  busyPlaceId,
  limit = 8,
}: {
  counters: PlaceCounter[];
  /** "I'm here" at one of these places; leave out while a visit is open somewhere. */
  onCheckIn?: (place: { id: string; name: string }) => void;
  onForget: () => void;
  busyPlaceId?: string;
  limit?: number;
}) {
  const [forgetOpen, setForgetOpen] = React.useState(false);
  const keepRef = React.useRef<HTMLButtonElement>(null);
  if (counters.length === 0) return null;
  return (
    <section className="mt-10" aria-labelledby="my-places-title">
      <h2 id="my-places-title" className="font-display text-title-sm font-black">
        Your places
      </h2>
      <p className="mt-1 flex items-center gap-1.5 text-ink-soft">
        <Lock className="size-4 shrink-0" aria-hidden /> Only you see this. We keep counts, not a diary.
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {counters.slice(0, limit).map((c) => {
          const stage = c.stage ? TITLES[c.stage] : null;
          // The place name is right above, so the Spot count says "here" (spotLine names the place elsewhere).
          const spot = spotLine(c) ? `${c.spotWeeks} weeks here.` : null;
          const next = nextStageLine(c.visits);
          return (
            <li key={c.placeId} className="flex flex-wrap items-center gap-3 rounded-mini border-2 border-border-subtle bg-paper p-3">
              {/* min-w-48 keeps the name readable on phones: the stamp and button wrap below it instead. */}
              <div className="min-w-48 flex-1">
                <p className="font-bold">{c.placeName}</p>
                <p className="text-label text-ink-soft">
                  {c.visits > 0 ? `${c.visits} ${c.visits === 1 ? "visit" : "visits"} counted.` : "Visited."}
                  {spot ? ` ${spot}` : ""}
                  {next ? ` ${next}` : ""}
                </p>
              </div>
              {stage && c.stage && (
                <Stamp size="sm" icon={<stage.Icon />}>
                  {stage.word}
                </Stamp>
              )}
              {onCheckIn && (
                <button
                  type="button"
                  onClick={() => onCheckIn({ id: c.placeId, name: c.placeName })}
                  aria-label={`I'm here: ${c.placeName}`}
                  aria-disabled={busyPlaceId === c.placeId || undefined}
                  className={cn(buttonStyles.secondary, "min-h-12 px-4 text-label")}
                >
                  <MapPinCheck className="size-4" aria-hidden /> I&apos;m here
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <Button variant="quiet" onClick={() => setForgetOpen(true)} className="mt-2 -ml-4 text-label">
        Forget my places
      </Button>
      <Dialog
        open={forgetOpen}
        onOpenChange={setForgetOpen}
        size="sm"
        initialFocus={keepRef}
        title="Forget your places?"
        description="This clears your place counts on this phone. Your Glory and First Steps stay."
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button ref={keepRef} size="sm" onClick={() => setForgetOpen(false)}>
            Keep them
          </Button>
          <Button
            variant="quiet"
            onClick={() => {
              onForget();
              setForgetOpen(false);
            }}
          >
            Forget
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
