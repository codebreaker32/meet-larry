"use client";

import { Gem } from "lucide-react";
import { Badge } from "@/components/ui";

/**
 * True only when the server marked the item as less known: Qloo applied the Hidden Gems filter AND
 * returned it under LESS_KNOWN_MAX (src/lib/qloo.ts isLessKnownResult). Never from the request alone.
 */
export function isLessKnown(x: unknown): boolean {
  return !!x && typeof x === "object" && (x as { lessKnown?: unknown }).lessKnown === true;
}

/** "Hidden gem": only for items the server marked (isLessKnown). */
export function HiddenGemBadge() {
  return (
    <Badge variant="paper" icon={<Gem className="size-3" />}>
      Hidden gem
    </Badge>
  );
}
