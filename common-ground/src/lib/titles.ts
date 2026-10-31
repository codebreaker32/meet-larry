// The title registry (component-specs C1, D10). One registry drives badges, the profile, check-in
// results and copy. Icons are unique across titles and never reuse a category icon, Report's Flag,
// the safety Shields, the vibe chips, Trophy/Medal (Sports, Players), Flame (streak culture) or Sparkles.
import {
  Anchor,
  Award,
  Backpack,
  Castle,
  Crown,
  Footprints,
  HandPlatter,
  MountainSnow,
  PartyPopper,
  ShipWheel,
  Sprout,
  Sun,
  Swords,
  type LucideIcon,
} from "lucide-react";
import {
  FRIEND_RANK_TITLES,
  PUBLIC_TITLES,
  STAGE_VISITS,
  STAGES,
  type FriendTitle,
  type PublicTitle,
  type Stage,
  type TitleFamily,
  type TitleId,
} from "./types/titles";

export type { FriendTitle, PublicTitle, Stage, TitleFamily, TitleId };
export { FRIEND_RANK_TITLES, PUBLIC_TITLES, STAGE_VISITS, STAGES };

export interface TitleInfo {
  word: string;
  family: TitleFamily;
  /** Podium and friend visit titles. */
  rank?: 1 | 2 | 3;
  /** Stage thresholds: verified visits at one place (one per place per day). */
  visits?: number;
  Icon: LucideIcon;
  /** Easy-read meaning, read on the badge's info sheet. */
  meaning: string;
}

export const TITLES: Record<TitleId, TitleInfo> = {
  rookie: { word: "Rookie", family: "stage", visits: STAGE_VISITS.rookie, Icon: Sprout, meaning: "Your first visit here." },
  regular: { word: "Regular", family: "stage", visits: STAGE_VISITS.regular, Icon: Footprints, meaning: "You've been here 3 times." },
  veteran: { word: "Veteran", family: "stage", visits: STAGE_VISITS.veteran, Icon: Backpack, meaning: "You've been here 6 times." },
  elite: { word: "Elite", family: "stage", visits: STAGE_VISITS.elite, Icon: Award, meaning: "You've been here 10 times." },
  legend: { word: "Legend", family: "stage", visits: STAGE_VISITS.legend, Icon: MountainSnow, meaning: "You've been here 20 times." },
  "final-boss": { word: "Final Boss", family: "public", rank: 1, Icon: Crown, meaning: "Most visits here of anyone on Larry." },
  guildmaster: { word: "Guildmaster", family: "public", rank: 2, Icon: Castle, meaning: "Second most visits here of anyone on Larry." },
  shogun: { word: "Shogun", family: "public", rank: 3, Icon: Swords, meaning: "Third most visits here of anyone on Larry." },
  "party-leader": { word: "Party Leader", family: "friends", rank: 1, Icon: PartyPopper, meaning: "Most visits here among your friends." },
  "squad-captain": { word: "Squad Captain", family: "friends", rank: 2, Icon: ShipWheel, meaning: "Second most visits here among your friends." },
  "crew-leader": { word: "Crew Leader", family: "friends", rank: 3, Icon: Anchor, meaning: "Third most visits here among your friends." },
  host: { word: "Host", family: "friends", Icon: HandPlatter, meaning: "Made the most plans here that friends came to." },
};

/** Glory, the lifetime score. Sun: Glory as light, not a flame (flames read as streaks). */
export const GLORY = {
  word: "Glory",
  Icon: Sun,
  meaning: "Earned by real visits. It never goes down.",
} as const;

export const titleWord = (id: TitleId) => TITLES[id].word;

/** The stage for this many verified visits at one place, or null before the first. */
export function stageFor(visits: number): Stage | null {
  let out: Stage | null = null;
  for (const s of STAGES) if (visits >= STAGE_VISITS[s]) out = s;
  return out;
}

/** The next stage and how many verified visits away it is, or null at Legend. */
export function nextStage(visits: number): { stage: Stage; visitsAway: number } | null {
  const next = STAGES.find((s) => STAGE_VISITS[s] > visits);
  return next ? { stage: next, visitsAway: STAGE_VISITS[next] - Math.max(0, visits) } : null;
}

/** The podium title for a rank (1 to 3). */
export const publicTitleFor = (rank: 1 | 2 | 3): PublicTitle => PUBLIC_TITLES[rank - 1];
/** The friends visit title for a rank (1 to 3). */
export const friendTitleFor = (rank: 1 | 2 | 3): FriendTitle => FRIEND_RANK_TITLES[rank - 1];
