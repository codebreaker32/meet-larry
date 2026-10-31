// Shared between server and client. Keep this file free of server-only imports.
import type { GroupChatResult } from "./contracts";

export const DOMAINS = {
  movie: { urn: "urn:entity:movie", label: "Movies" },
  tv_show: { urn: "urn:entity:tv_show", label: "TV" },
  artist: { urn: "urn:entity:artist", label: "Music" },
  // Qloo's hackathon guide says `video_game`, but the API only accepts `videogame`.
  videogame: { urn: "urn:entity:videogame", label: "Games" },
  book: { urn: "urn:entity:book", label: "Books" },
  // Sports teams and leagues are Qloo brands tagged as sports organisations.
  sports_team: { urn: "urn:entity:brand", label: "Sports", tags: ["urn:tag:genre:brand:sports_organization"] },
  // Players are Qloo people tagged as athletes.
  athlete: { urn: "urn:entity:person", label: "Players", tags: ["urn:tag:genre:person:athlete"] },
  podcast: { urn: "urn:entity:podcast", label: "Podcasts" },
  brand: { urn: "urn:entity:brand", label: "Brands" },
  destination: { urn: "urn:entity:destination", label: "Travel" },
  person: { urn: "urn:entity:person", label: "People" },
} as const satisfies Record<string, { urn: string; label: string; tags?: readonly string[] }>;

export type Domain = keyof typeof DOMAINS;

export const DOMAIN_KEYS = Object.keys(DOMAINS) as Domain[];

/**
 * Several domains share a Qloo type (sports_team and brand are both urn:entity:brand; athlete and
 * person are both urn:entity:person). Pass the domain you searched or queried as `prefer` so the
 * result keeps it; otherwise the first matching domain wins.
 */
export function domainFromUrn(urn: string, prefer?: Domain): Domain | undefined {
  if (prefer && DOMAINS[prefer].urn === urn) return prefer;
  return DOMAIN_KEYS.find((d) => DOMAINS[d].urn === urn);
}

/** Qloo tag filters a domain needs (e.g. sports organisations), if any. */
export function domainTags(d: Domain): readonly string[] {
  const def = DOMAINS[d] as { tags?: readonly string[] };
  return def.tags ?? [];
}

export interface TasteItem {
  id: string; // Qloo entity_id
  name: string;
  domain: Domain;
  image?: string;
}

export interface Profile {
  name: string;
  items: TasteItem[];
}

/** A recommendation that fits both people, with who it came from. */
export interface Bridge {
  id: string;
  name: string;
  domain: Domain;
  image?: string;
  affinity: number;
  /** Larry's specific reason this fits BOTH people (written by the agent from Qloo candidates), e.g. "Stardew Valley: cosy farming like Minecraft, gentle folk soundtrack like Fleet Foxes". */
  why?: string;
  /** Names of items from person A that drove this result. */
  fromA: string[];
  /** Names of items from person B that drove this result. */
  fromB: string[];
  /** Qloo explainability score of each person's strongest contributing pick (0-1), when known. */
  scoreA?: number;
  scoreB?: number;
}

export interface CommonGround {
  /** Items both people picked. */
  shared: TasteItem[];
  /** Recommendations driven by both people's tastes, best first. */
  bridges: Bridge[];
  /** True when Larry chose and ordered the bridges: keep that order (never re-sort by affinity). */
  curated?: boolean;
}

export interface Place {
  id: string;
  name: string;
  address?: string;
  distanceKm?: number;
  tags: string[];
  affinity: number;
  /** Cover photo (https://images.qloo.com only), for venue cards. */
  image?: string;
  /** Easy-read line about the place itself: its kind, why it is low-pressure, and Qloo's description, e.g. "A bookshop. Easy to browse together. Usually quiet." */
  reason?: string;
  /** Qloo's explainability, worded as evidence for the small "Why?" chip, e.g. "Qloo: people who like Spirited Away rate this place." Never shown as the main line. */
  qlooWhy?: string;
}

export type StepKind = "go" | "say" | "show";

export interface FirstStep {
  id: string;
  kind: StepKind;
  text: string;
  withPerson?: string;
  createdAt: number;
  done: boolean;
  doneAt?: number;
  /** Last time the "Did you do it?" check-in asked about this step and got "Not yet". */
  checkedAt?: number;
  /** How it went, if they said. Stays on the device. */
  feeling?: Feeling;
  /** Exposure-ladder rung for "go" steps (0 = first visit). A done step can suggest the next rung. */
  rung?: number;
}

export type Feeling = "good" | "okay" | "hard";

/**
 * POST /api/larry (solo chat with Larry) answers with the same NDJSON stream as /api/chat:
 * zero or more "progress" events, then one "done" (with a GroupChatResult) or "error".
 */
export type LarryEvent =
  | { type: "progress"; tool: string; text: string }
  | { type: "done"; result: GroupChatResult }
  | { type: "error"; error: string };
