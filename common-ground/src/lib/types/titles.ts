// Title ids, families and stage thresholds (component-specs C1). Pure data, no icons: the registry
// with words, Lucide icons and meanings is src/lib/titles.ts. Frozen after Stage 0.

/** Private stages at one place, counted in verified visits (one per place per day). */
export type Stage = "rookie" | "regular" | "veteran" | "elite" | "legend";
/** Public podium at a place, among everyone on Larry (rank 1 to 3). Accounts must be 18+. */
export type PublicTitle = "final-boss" | "guildmaster" | "shogun";
/** Among friends who both share (rank 1 to 3), plus Host (most attended plans made there). */
export type FriendTitle = "party-leader" | "squad-captain" | "crew-leader" | "host";
export type TitleId = Stage | PublicTitle | FriendTitle;
export type TitleFamily = "stage" | "public" | "friends";

/** Stages in order, lowest first. */
export const STAGES = ["rookie", "regular", "veteran", "elite", "legend"] as const satisfies readonly Stage[];

/** Verified visits at one place that reach each stage (user's queue: 1, 3, 6, 10, 20). */
export const STAGE_VISITS = {
  rookie: 1,
  regular: 3,
  veteran: 6,
  elite: 10,
  legend: 20,
} as const satisfies Record<Stage, number>;

/** Podium titles by rank: index 0 is rank 1. */
export const PUBLIC_TITLES = ["final-boss", "guildmaster", "shogun"] as const satisfies readonly PublicTitle[];

/** Friend visit titles by rank: index 0 is rank 1. Host is separate (plans, not visits). */
export const FRIEND_RANK_TITLES = ["party-leader", "squad-captain", "crew-leader"] as const satisfies readonly FriendTitle[];

/** How many places a person holds each public title at ("Final Boss at 2 places"). Absent means 0. */
export type PublicTitleCounts = Partial<Record<PublicTitle, number>>;
