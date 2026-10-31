// Mood, age range and Hidden Gems: held on the device and sent only with the person's own requests.
// Never shown to anyone else: not in rooms or Open to meet (next-round-queue.md).

export type Mood = "chill" | "social" | "curious" | "low-energy" | "hype";
export const MOODS = ["chill", "social", "curious", "low-energy", "hype"] as const satisfies readonly Mood[];

/** Asked once at card creation as ranges, never a birthday. Minimum age 13. */
export type AgeBucket = "13-17" | "18-24" | "25-34" | "35-44" | "45+";
export const AGE_BUCKETS = ["13-17", "18-24", "25-34", "35-44", "45+"] as const satisfies readonly AgeBucket[];

/** True for every range from 18 up. Unknown age counts as under 18 (D17). */
export const isAdultBucket = (b: AgeBucket | undefined | null): boolean => !!b && b !== "13-17";

/** Sent with a person's own requests only, as the optional `signals` field of a request body. */
export interface RequestSignals {
  mood?: Mood;
  ageBucket?: AgeBucket;
  /** Hidden Gems switch: lean towards less popular picks (Qloo filter.popularity.max). */
  hiddenGems?: boolean;
}

/**
 * AgeBucket -> the value for Qloo's `signal.demographics.age`. Always ONE of Qloo's own ranges
 * (docs.qloo.com/reference/parameters): 24_and_younger | 25_to_29 | 30_to_34 | 35_to_44 | 45_to_54 |
 * 55_and_older. Never a comma list: a refused value made the old code retry without any signals,
 * quietly losing age, mood and Hidden Gems. Probe note (31 Oct 2026): age alone is not enough for
 * insights (Qloo answers 400 "at least one valid signal or filter is required"), so a value can only
 * be checked alongside an entity signal; the single values below come from Qloo's documented set,
 * and insightsCall's `fellBack` flag shows at runtime whether Qloo accepted them.
 */
export const QLOO_AGE_MAP = {
  "13-17": "24_and_younger",
  "18-24": "24_and_younger",
  "25-34": "25_to_29",
  "35-44": "35_to_44",
  "45+": "45_to_54",
} as const satisfies Record<AgeBucket, string>;

/**
 * The one "less known" line for the whole app (qloo-hooks-plan P3): Qloo's popularity is a 0-1
 * percentile, so below 0.9 means outside Qloo's top 10%. Hidden Gems, the Fingerprint count and every
 * "hidden gem" label use this number, and a label shows only when Qloo really applied the filter.
 */
export const LESS_KNOWN_MAX = 0.9;
