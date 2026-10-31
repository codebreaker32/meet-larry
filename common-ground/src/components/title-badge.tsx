"use client";

import * as React from "react";
import { Info } from "lucide-react";
import { BadgeMedal, badgeInfo, badgeMeaning, badgeWord, type BadgeId, type MedalSize } from "@/components/badges/badge-medal";
import { Dialog, Stamp } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * A title (or Glory) as a badge: the drawn medal plus the word as real text on a Stamp, with an
 * optional detail line ("at 2 places", "at Café Condi"). Tap-only users get the meaning from an info
 * sheet (never a hover tooltip): with `info`, the whole badge is one 48px+ button that opens it.
 *
 * - layout "row": medal left, stamp right (lists). "stack": medal above the stamp (shelves, moments).
 * - `earned={false}`: the outline medal and a quiet stamp, for the owner's collection only.
 * - `fresh`: just earned; the Stamp deals in once (still under reduced motion).
 */
export function TitleBadge({
  id,
  detail,
  size = "md",
  layout = "row",
  earned = true,
  fresh = false,
  info = false,
  srDetail,
  className,
}: {
  id: BadgeId;
  detail?: React.ReactNode;
  size?: MedalSize;
  layout?: "row" | "stack";
  earned?: boolean;
  fresh?: boolean;
  /** Make the badge a button that opens its meaning. */
  info?: boolean;
  /** Extra words for screen readers only (e.g. "Only you can see this."). */
  srDetail?: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const word = badgeWord(id);
  const reg = badgeInfo(id);
  const body = (
    <>
      <BadgeMedal id={id} size={size} earned={earned} />
      <Stamp
        variant={fresh ? "solid" : "outline"}
        size={size === "sm" ? "sm" : "md"}
        fresh={fresh}
        detail={detail}
        className={cn(!earned && "border-dashed border-border-control text-ink-soft")}
      >
        {word}
        {!earned && <span className="sr-only">, not yet</span>}
        {srDetail && <span className="sr-only">. {srDetail}</span>}
      </Stamp>
    </>
  );
  const box = cn("inline-flex max-w-full items-center gap-3", layout === "stack" && "flex-col gap-2 text-center", className);

  if (!info) {
    return (
      <span className={box} data-title-badge={id}>
        {body}
      </span>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-title-badge={id}
        className={cn(box, "press press-flat min-h-12 min-w-12 rounded-mini p-1 text-left hover:bg-table")}
      >
        {body}
        <span className="sr-only">. What does this mean?</span>
        <Info aria-hidden className={cn("size-4 shrink-0 text-ink-soft", layout === "stack" && "hidden")} />
      </button>
      <Dialog open={open} onOpenChange={setOpen} size="sm" icon={<reg.Icon className="size-5" />} title={word} description={badgeMeaning(id)}>
        <div className="flex justify-center py-2">
          <BadgeMedal id={id} size="xl" earned={earned} />
        </div>
      </Dialog>
    </>
  );
}
