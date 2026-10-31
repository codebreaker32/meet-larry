"use client";

import * as React from "react";
import { Smartphone } from "lucide-react";
import { buttonStyles } from "@/components/link-button";
import { Poster } from "@/components/taste-card";
import { Dialog } from "@/components/ui/dialog";
import type { TasteItem } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * "Show it instead": the opener as a big card the person can turn round and show, so nobody has
 * to say it out loud (persona walkthrough, Meera and Rohan; user-research R7). The line is the
 * person's own plan line; nothing is read aloud and nothing is sent anywhere.
 */
export function ShowThis({
  line,
  item,
  className,
}: {
  /** The opener: what they would otherwise say. */
  line: string;
  /** The shared thing to bring up, shown as its poster above the line. */
  item?: TasteItem;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn(buttonStyles.secondary, "min-h-12 px-4 text-label", className)}>
        <Smartphone className="size-5" aria-hidden /> Show it instead
      </button>
      <Dialog open={open} onOpenChange={setOpen} title="Show this" description="Turn the phone round so they can read it.">
        {/* Only while open, so the line is not in the page twice for search and screen readers. */}
        {open && (
          <div className="flex flex-col items-center gap-4 text-center">
            {item && <Poster item={item} className="h-40 w-28" sizes="120px" />}
            <p className="font-display text-title-md font-black leading-tight text-ink">{line}</p>
            <button type="button" onClick={() => setOpen(false)} className={cn(buttonStyles.primary, "w-full")}>
              Done
            </button>
          </div>
        )}
      </Dialog>
    </>
  );
}
