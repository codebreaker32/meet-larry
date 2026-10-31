"use client";

import * as React from "react";
import { ChevronDown, MapPinned } from "lucide-react";
import { WHY_HERE_TEXT, areaLineSafe, whyHereAllowed } from "@/lib/heatmap";
import { cn } from "@/lib/utils";

/**
 * The ticket's "Why here?" line (qloo-hooks-plan 3.6): the area line, and one tap for the one
 * sentence on how Larry chose it. Off for groups of 2 and for any line that names people or homes.
 */
export function WhyHere({ line, groupSize, className }: { line?: string | null; groupSize?: number; className?: string }) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  if (!whyHereAllowed(groupSize, line) || !areaLineSafe(line!)) return null;
  return (
    <div className={cn("mt-2", className)} data-testid="why-here">
      <p className="flex items-start gap-2 text-label font-bold leading-snug">
        <MapPinned className="mt-0.5 size-4 shrink-0" aria-hidden />
        {line}
      </p>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="press press-flat -ml-2 flex min-h-12 items-center gap-1 rounded-full px-2 text-label font-bold underline decoration-2 underline-offset-4 hover:bg-table"
      >
        Why here?
        <ChevronDown className={cn("size-4 transition-transform duration-(--dur-quick)", open && "rotate-180")} aria-hidden />
      </button>
      <p id={id} hidden={!open} className="rounded-tile bg-table p-2.5 text-label leading-snug">
        {WHY_HERE_TEXT}
      </p>
    </div>
  );
}
