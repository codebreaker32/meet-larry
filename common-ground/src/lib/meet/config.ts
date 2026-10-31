// Open to meet: the numbers that keep it short-lived and hard to abuse (see PRODUCT.md).
// Shared by server and client, so nothing server-only lives here.

/** "Open to meet" switches itself off after this long. Re-opening starts the 3 hours again. */
export const MEET_TTL_MS = 3 * 60 * 60 * 1000;
/** A phone that stops checking in for this long counts as gone (it left, or the page closed). */
export const MEET_IDLE_MS = 10 * 60 * 1000;
/** Presence is written at most this often per person. */
export const MEET_SEEN_EVERY_MS = 60 * 1000;
/** How often the meet page asks who is here. */
export const MEET_POLL_MS = 15 * 1000;

/**
 * Picks used from a persona (its newest): enough for real common ground, too few to fish with.
 * They are fixed for the whole visit: re-opening with other picks is refused (see PICKS_LOCK_MS).
 */
export const MEET_LIKES_MAX = 12;
/** Picks both people chose that are counted per person (and named, at most one per person). */
export const MEET_SHARED_MAX = 3;
/**
 * Someone is counted in the list only with a Qloo bridge, or with at least this many picks both
 * chose: one pick in common is something anyone could fish for.
 */
export const MEET_MIN_SHARED_PICKS = 2;
/** Shared things (groups) shown at once in the list. */
export const MEET_NEARBY_MAX = 12;

/**
 * Proof of presence: the phone's location must be this close to the venue (Qloo's coordinates)
 * to switch on, to see the list and to wave. The location is checked and thrown away at once.
 */
export const MEET_NEAR_M = 150;
/** Extra distance allowed for a fuzzy GPS fix, at most. */
export const MEET_SLACK_M = 100;
/** A fix less precise than this can't show that someone is at the venue. */
export const MEET_ACCURACY_MAX_M = 300;

/** After switching off, picks stay fixed at that venue on that phone for this long. */
export const PICKS_LOCK_MS = 30 * 60 * 1000;
/** Different venues one access code can switch on at in a day: nobody can sweep a town. */
export const MEET_VENUES_PER_CODE_DAY = 6;

/** Waves one person can send in one visit (one per person, and this many in all). */
export const WAVES_PER_VISIT = 8;
/** Contact or address talk this early in a meet chat makes Larry step in. */
export const MEET_EARLY_MS = 30 * 60 * 1000;
/** Larry steps in at most once per kind of red flag in this time, so it doesn't nag. */
export const RED_FLAG_COOLDOWN_MS = 5 * 60 * 1000;

/** Reports are kept this long for review. */
export const REPORT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Messages kept with a report from a chat. */
export const REPORT_MESSAGES = 20;

export const REPORT_REASONS = ["unsafe", "rude", "contact", "underage", "spam", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** What each report reason means, in easy-read words. */
export const REPORT_REASON_TEXT: Record<ReportReason, string> = {
  unsafe: "They made me feel unsafe",
  rude: "They were rude or mean",
  contact: "They kept asking for my number, address or socials",
  underage: "I think they are under 18",
  spam: "Spam or selling something",
  other: "Something else",
};
