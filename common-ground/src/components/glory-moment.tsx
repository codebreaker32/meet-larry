"use client";

import { BadgeMedal } from "@/components/badges/badge-medal";
import { GloryCount } from "@/components/glory-count";
import { LarryAvatar } from "@/components/larry-avatar";
import { TitleBadge } from "@/components/title-badge";
import { GLORY, type Stage } from "@/lib/titles";
import { cn } from "@/lib/utils";

/**
 * The Glory moment, right after a verified visit: Larry's avatar holding up the sun badge, the gain
 * tied to one named real action, the lifetime total, and a just-earned stage if there is one.
 *
 * - The sun's rays turn once and its face lifts (SMIL inside the SVG), then everything rests. Under
 *   reduced motion nothing moves: the same picture appears at once.
 * - The gain is announced once (GloryCount's polite status line); the art is decoration.
 * - Nothing here comes from chat or screen time: callers mount it only for a verified visit.
 */
export function GloryMoment({
  total,
  gain,
  placeName,
  stageEarned,
  className,
}: {
  /** The new lifetime total. */
  total: number;
  /** What this visit added (10 for a visit, +5 for "said hi"). */
  gain: number;
  placeName: string;
  /** A stage reached on this visit, shown as a fresh badge. */
  stageEarned?: Stage | null;
  className?: string;
}) {
  return (
    <section
      aria-label={`${GLORY.word} earned`}
      data-glory-moment
      className={cn("flex flex-col gap-4 rounded-panel border-2 border-ink bg-paper p-4 sm:flex-row sm:items-center sm:p-5", className)}
    >
      <div className="relative mx-auto shrink-0 sm:mx-0">
        <LarryAvatar variant="full" size="xl" decorative />
        <span className="absolute -bottom-3 -right-5">
          <BadgeMedal id="glory" size="md" animate />
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <GloryCount value={total} size="hero" gain={gain > 0 ? { amount: gain, reason: `for your visit to ${placeName}.` } : undefined} />
        {stageEarned && <TitleBadge id={stageEarned} detail={`at ${placeName}`} fresh size="sm" srDetail="Only you can see this." />}
      </div>
    </section>
  );
}
