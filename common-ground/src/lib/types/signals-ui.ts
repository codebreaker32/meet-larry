// Qloo-powered extras: Taste Fingerprint, Rising, Match Day and the area line (heatmap-lite, D13).
import type { Profile, TasteItem, Domain } from "../types";

export interface Fingerprint {
  /** 0-100: how far off the beaten path the card is, from real Qloo popularity. Left out, not guessed, when unknown. */
  offBeatenPct?: number;
  /** Strongest domains, strongest first. */
  strongest: Domain[];
  /** Taste Twin (cross-domain): "Your Minecraft side in music: beabadoobee". */
  twin?: { fromDomain: Domain; toDomain: Domain; entity: TasteItem };
}

/** POST /api/fingerprint (1E) */
export interface FingerprintRequest {
  card: Profile;
}

/** GET /api/rising?city= (2E): one Larry line per item, cached 24 hours per city. */
export interface RisingItem {
  entity: TasteItem;
  /** Larry's witty, grounded line (labelled AI where shown). */
  larryLine: string;
  /** The same in one plain line. */
  plainLine: string;
}

/** GET /api/matchday?entities= (2E) */
export interface MatchDay {
  team: string;
  league: string;
  /** From a public schedule, labelled with its source. Daytime tickets only by default (D5). */
  fixture?: { teams: string; when: string };
  source: string;
}

/** The area line on the Plan Ticket (urn:heatmap): areas only, never people. */
export interface AreaPick {
  /** Best first, at most 3. score 0-1. */
  areas: { name: string; score: number }[];
  larryLine: string;
}

/** src/lib/rising.ts (2E) */
export type GetRising = (city: string) => Promise<RisingItem[]>;
/** src/lib/matchday.ts (2E) */
export type GetMatchDay = (entities: string[]) => Promise<MatchDay[]>;
/** src/lib/heatmap.ts (2E) */
export type PickArea = (card: Profile, near: { lat: number; lon: number }) => Promise<AreaPick | null>;
