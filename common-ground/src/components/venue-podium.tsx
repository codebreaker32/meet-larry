"use client";

import * as React from "react";
import { MapPin, RefreshCw } from "lucide-react";
import { TitleBadge } from "@/components/title-badge";
import { Button } from "@/components/ui";
import type { PodiumEntry } from "@/lib/types/people";
import { cn } from "@/lib/utils";

/**
 * The public top 3 at ONE place, under made-up place names (a different one at every place, so the
 * Final Boss here can't be matched to a profile or to anyone's other places).
 *
 * - No visit numbers, no times, no "took Final Boss" events, and no links: a name goes nowhere.
 * - The device finds its own name in the public list and marks the row "You" (only this phone knows).
 * - Below the minimum number of people, the podium stays closed with a warm line.
 * - Re-roll: a new made-up name here, for someone on the podium who is signed in.
 */
export function VenuePodium({
  placeName,
  open,
  entries,
  myAlias,
  onReroll,
  className,
}: {
  placeName: string;
  open: boolean;
  entries: PodiumEntry[];
  /** This device's name at this place, if it has one. */
  myAlias?: string | null;
  /** Shown only when this device is on the podium. Resolves true when the name changed. */
  onReroll?: () => Promise<boolean>;
  className?: string;
}) {
  const [busy, setBusy] = React.useState(false);
  const [said, setSaid] = React.useState("");
  const sorted = [...entries].sort((a, b) => a.rank - b.rank).slice(0, 6);
  const mine = !!myAlias && sorted.some((e) => e.alias === myAlias);

  return (
    <section aria-labelledby="podium-title" className={cn("flex flex-col gap-3 rounded-panel border-2 border-ink bg-paper p-4 sm:p-5", className)} data-podium>
      <h2 id="podium-title" className="font-display text-title-sm font-black">
        Top 3 here
      </h2>
      {!open || sorted.length === 0 ? (
        <p className="max-w-measure text-ink-soft" data-podium-closed>
          The top 3 opens once a few more regulars count here. Visits always count for your own stages.
        </p>
      ) : (
        <>
          <ol className="flex flex-col gap-2">
            {sorted.map((e) => {
              const you = !!myAlias && e.alias === myAlias;
              return (
                <li
                  key={`${e.rank}-${e.alias}`}
                  className={cn("flex flex-wrap items-center gap-3 rounded-mini p-2", you ? "bg-table ring-2 ring-ink" : "ring-2 ring-line")}
                  data-podium-row
                >
                  <TitleBadge id={e.title} size="sm" />
                  <div className="min-w-0">
                    <p className="font-bold" data-alias>
                      {you ? (
                        <>
                          You <span className="font-normal text-ink-soft">({e.alias})</span>
                        </>
                      ) : (
                        e.alias
                      )}
                    </p>
                    <p className="flex items-center gap-1 text-label text-ink-soft">
                      <MapPin className="size-4 shrink-0" aria-hidden /> at {placeName}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="max-w-measure text-label text-ink-soft">
            Made-up names, different at every place. Nobody can message anyone from here.
          </p>
        </>
      )}
      {mine && onReroll && (
        <div className="flex flex-col items-start gap-1">
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw />}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setSaid("");
              const ok = await onReroll().catch(() => false);
              setBusy(false);
              setSaid(ok ? "Done. You have a new made-up name here." : "Hmm, that didn't go through. Try again in a moment?");
            }}
          >
            New name at this place
          </Button>
          <p role="status" aria-live="polite" className="font-bold empty:hidden">
            {said}
          </p>
        </div>
      )}
    </section>
  );
}
