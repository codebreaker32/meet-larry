// Larry's witty lines, written fresh from REAL shared items, with a fixed fallback set (src/lib/witty.ts).
// Anonymous: no names, looks, gender or age. No invented trivia.
import type { Mood } from "./signals";

export type WittyKind = "meet" | "nudge" | "bridge-why" | "opener" | "quest" | "playback" | "rising";

/** A real item the line may name (a Qloo item, place or title). */
export interface SharedItem {
  name: string;
  kind?: "pick" | "bridge" | "place" | "team" | "title";
}

export interface WittyOpts {
  mood?: Mood;
  /** Charge hook for the model call (access code or account budget). */
  budget?: { charge: (usd: number) => void | Promise<void> };
  signal?: AbortSignal;
}

export interface WittyResult {
  /** Larry's line. */
  line: string;
  /** The same in one plain easy-read sentence. */
  plain: string;
  source: "model" | "fallback";
}

export type WittyLineFn = (kind: WittyKind, items: SharedItem[], opts?: WittyOpts) => Promise<WittyResult>;
