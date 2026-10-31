// Rising (qloo-hooks-plan 3.5): what the live checks allow us to say honestly.
//
// `/v2/trending` has no location parameter, and `bias.trends` near a point returned films with
// `audience_growth: 0`: that is "big near you", not "rising". So there is no city chart here, and
// the text "rising in <city>" is never produced. What stays:
//  - "Big near you" is a picture row in card making (2A's /api/big-near-you). Not this file.
//  - "Climbing": an item's own weekly trend series, checked in code (climbingPasses). No probe has
//    yet returned a non-empty series, so nothing is labelled Climbing until one does; getRising()
//    answers an honest empty list and risingMiss() is the line Larry says instead.

import type { RisingItem } from "./types/signals-ui";

/** One week of an item's Qloo trend series (field names from Qloo's docs; unverified live). */
export interface TrendPoint {
  population_percent_delta?: number;
  population_rank_velocity?: number;
}

/** At least this many weekly points before a trend can be read. */
export const CLIMBING_MIN_POINTS = 4;

/**
 * The Climbing rule: a non-empty series of at least 4 weeks, the last 2 weeks' percent change both
 * above 0, and the rank velocity above 0. Anything missing fails (never guessed).
 */
export function climbingPasses(series: readonly TrendPoint[] | null | undefined): boolean {
  if (!series || series.length < CLIMBING_MIN_POINTS) return false;
  const last2 = series.slice(-2);
  const up = last2.every((p) => typeof p.population_percent_delta === "number" && p.population_percent_delta > 0);
  const v = series.at(-1)?.population_rank_velocity;
  return up && typeof v === "number" && v > 0;
}

/**
 * The contract's getRising (2D's /rising): an honest empty list. There is no verified per-city trend
 * in Qloo, so nothing is ever claimed as rising in a city.
 */
export async function getRising(city?: string): Promise<RisingItem[]> {
  void city;
  return [];
}

/** What Larry says when asked what's rising (/rising), then offers a plan. */
export function risingMiss(): { line: string; plain: string } {
  return {
    line: "Honest answer: nothing of yours is climbing that I can vouch for this week. Want a plan anyway?",
    plain: "Nothing you like is getting more popular right now that Larry can check. Larry can still make a plan.",
  };
}

/** Guard for any copy that mentions trends: never a city next to rising or climbing. */
export function cityClaim(text: string): boolean {
  return /\b(?:rising|climbing|trending)\b[^.]*\b(?:in|near|around)\s+\p{Lu}/u.test(text);
}
