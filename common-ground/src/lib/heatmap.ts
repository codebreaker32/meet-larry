// "Where your taste lives" (qloo-hooks-plan 3.6, renamed from "Where your people are"): only a
// "Why here?" line on the group Plan Ticket. No map, no ranked list of areas, no area names that
// Amazon didn't give, never people, never in Open to meet.
//
// The per-member heatmap picking (tasteAreas) is first in the cut order and is NOT built tonight:
// the live probe found one member's column empty in all 391 cells, so a "shared" map would quietly
// be one person's. pickArea() therefore answers null, and the ticket shows no area line. What is
// here is the rule for when a "Why here?" line may ever show, so the ticket slot is honest today.

import type { Profile } from "./types";
import type { AreaPick } from "./types/signals-ui";

/**
 * A "Why here?" line only for groups of 3-5. In a group of 2, a "fair" area plus your own trip time
 * would let you work out roughly where the other person is, so it is always off there.
 */
export const WHY_HERE_MIN_GROUP = 3;

/** The one sentence behind "Why here?", the same for everyone, naming no one's location. */
export const WHY_HERE_TEXT =
  "Larry picked an area where all your picks show up and nobody's trip is long, then the calmest open café there. No one's location is shown to anyone.";

/** Whether the ticket may show a "Why here?" line: a group of 3-5 and a real area line from the server. */
export function whyHereAllowed(groupSize: number | undefined, line: string | undefined | null): boolean {
  return !!line?.trim() && typeof groupSize === "number" && groupSize >= WHY_HERE_MIN_GROUP && groupSize <= 5;
}

/**
 * Words an area line may never contain: people, homes, counts or "fans live here" (validator from
 * the plan's guardrails). True when the line is safe to show.
 */
export function areaLineSafe(line: string): boolean {
  return !/\b(?:your people|fans live|lives?|home|house|near \p{Lu}\p{L}*'s|people (?:here|nearby)|\d+\s+(?:people|fans|users))\b/iu.test(line);
}

/** Not built tonight (cut order #1): always null, so the ticket never shows an invented area. */
export async function pickArea(card: Profile, near: { lat: number; lon: number }): Promise<AreaPick | null> {
  void card;
  void near;
  return null;
}
