"use client";

import * as React from "react";
import { GLORY, TITLES, STAGES, type Stage, type TitleFamily, type TitleId } from "@/lib/titles";
import { cn } from "@/lib/utils";

// The 13 badges, drawn in code (user decision, 30 Oct): Glory plus the 12 titles. Each one is a round
// medal in the card-table style: a paper edge with an ink line, a category-colour ring, an ink face and
// the D10 Lucide icon in paper. The word is never drawn inside the art: <TitleBadge/> sets it as real
// text on a Stamp beside the medal, so the medal is decoration (aria-hidden) and colour never carries
// the meaning on its own.

export type BadgeId = TitleId | "glory";

/** All 13, in the order the collection shows them. */
export const BADGE_IDS: readonly BadgeId[] = [
  "glory",
  "rookie",
  "regular",
  "veteran",
  "elite",
  "legend",
  "final-boss",
  "guildmaster",
  "shogun",
  "party-leader",
  "squad-captain",
  "crew-leader",
  "host",
];

export type BadgeFamily = TitleFamily | "glory";

/**
 * Ring colour per family, from the category palette (decoration only; the word is always beside it):
 * Glory is sunlight (TV yellow), private stages grow (Sports green), the public podium is Games
 * violet and friends are People pink.
 */
export const BADGE_RING: Record<BadgeFamily, string> = {
  glory: "var(--cat-tv)",
  stage: "var(--cat-sports)",
  public: "var(--cat-games)",
  friends: "var(--cat-people)",
};

export const badgeFamily = (id: BadgeId): BadgeFamily => (id === "glory" ? "glory" : TITLES[id].family);
export const badgeWord = (id: BadgeId): string => (id === "glory" ? GLORY.word : TITLES[id].word);
export const badgeMeaning = (id: BadgeId): string => (id === "glory" ? GLORY.meaning : TITLES[id].meaning);
export const badgeIcon = (id: BadgeId) => badgeInfo(id).Icon;
/** The registry entry (word, icon, meaning) for a badge. */
export const badgeInfo = (id: BadgeId) => (id === "glory" ? GLORY : TITLES[id]);

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";
function subscribeReduce(cb: () => void) {
  const m = window.matchMedia?.(REDUCE_QUERY);
  m?.addEventListener?.("change", cb);
  return () => m?.removeEventListener?.("change", cb);
}
/** True when the person asked for less motion. On the server it reads as true, so the first paint is still. */
function usePrefersStill(): boolean {
  return React.useSyncExternalStore(
    subscribeReduce,
    () => window.matchMedia?.(REDUCE_QUERY).matches ?? false,
    () => true,
  );
}

export type MedalSize = "sm" | "md" | "lg" | "xl";
const PX: Record<MedalSize, number> = { sm: 48, md: 72, lg: 104, xl: 144 };

/** Stage tier, 1 (Rookie) to 5 (Legend): drawn as filled studs on the ring. */
const tierOf = (id: BadgeId): number => (STAGES as readonly string[]).indexOf(id) + 1;

export function BadgeMedal({
  id,
  size = "md",
  earned = true,
  animate = false,
  className,
}: {
  id: BadgeId;
  size?: MedalSize;
  /** False draws the outline only (a badge not earned yet, in the owner's collection). */
  earned?: boolean;
  /** Glory only: the sun's rays turn once and the face lifts (the Glory moment). Still under reduced motion. */
  animate?: boolean;
  className?: string;
}) {
  const reduce = usePrefersStill();
  const family = badgeFamily(id);
  const info = badgeInfo(id);
  const ring = earned ? BADGE_RING[family] : "var(--line)";
  const px = PX[size];
  const moving = animate && earned && !reduce;
  const tier = family === "stage" ? tierOf(id) : 0;
  const rank = id !== "glory" ? TITLES[id].rank : undefined;

  return (
    <svg
      viewBox="0 0 96 96"
      width={px}
      height={px}
      aria-hidden
      focusable="false"
      data-badge={id}
      data-earned={earned ? "yes" : "no"}
      data-animated={moving ? "yes" : undefined}
      className={cn("shrink-0 overflow-visible", className)}
    >
      {/* Glory's rays sit outside the edge: light, not a flame. */}
      {family === "glory" && (
        <g stroke={earned ? "var(--ink)" : "var(--line)"} strokeWidth={3} strokeLinecap="round">
          {moving && (
            <animateTransform attributeName="transform" type="rotate" from="-30 48 48" to="0 48 48" dur="1.2s" fill="freeze" calcMode="spline" keySplines="0.16 1 0.3 1" keyTimes="0;1" />
          )}
          {Array.from({ length: 12 }, (_, i) => {
            const a = (i * Math.PI) / 6;
            const r1 = 44;
            const r2 = i % 2 ? 48 : 51;
            return (
              <line
                key={i}
                x1={48 + r1 * Math.cos(a)}
                y1={48 + r1 * Math.sin(a)}
                x2={48 + r2 * Math.cos(a)}
                y2={48 + r2 * Math.sin(a)}
              />
            );
          })}
        </g>
      )}

      {/* The paper edge with an ink line, like a stamp on the table. */}
      <circle cx={48} cy={48} r={42} fill="var(--paper)" stroke={earned ? "var(--ink)" : "var(--ink-500)"} strokeWidth={3} strokeDasharray={earned ? undefined : "5 4"} />
      {/* The category ring. */}
      <circle cx={48} cy={48} r={35.5} fill="none" stroke={ring} strokeWidth={8} />

      {/* Podium and friend ranks: one, two or three notches at the top of the ring. */}
      {rank && (
        <g fill={earned ? "var(--ink)" : "var(--ink-500)"}>
          {Array.from({ length: rank }, (_, i) => {
            const x = 48 + (i - (rank - 1) / 2) * 8;
            return <rect key={i} x={x - 2} y={9.5} width={4} height={8} rx={1.5} />;
          })}
        </g>
      )}

      {/* Stage studs along the bottom of the ring: filled up to the tier. */}
      {tier > 0 && (
        <g>
          {STAGES.map((s: Stage, i) => {
            const a = Math.PI / 2 + ((i - 2) * Math.PI) / 9;
            const on = i < tier;
            return (
              <circle
                key={s}
                cx={48 + 35.5 * Math.cos(a)}
                cy={48 + 35.5 * Math.sin(a)}
                r={3.2}
                fill={on && earned ? "var(--ink)" : "var(--paper)"}
                stroke={earned ? "var(--ink)" : "var(--ink-500)"}
                strokeWidth={1.5}
              />
            );
          })}
        </g>
      )}

      {/* The ink face with the icon in paper. */}
      <g transform="translate(48 48)">
        <g>
          {moving && <animateTransform attributeName="transform" type="scale" values="0.85;1.06;1" keyTimes="0;0.6;1" dur="0.9s" fill="freeze" />}
          <g transform="translate(-48 -48)">
            <circle cx={48} cy={48} r={28} fill={earned ? "var(--ink)" : "var(--paper)"} stroke={earned ? "none" : "var(--ink-500)"} strokeWidth={2} />
            <info.Icon x={30} y={30} width={36} height={36} strokeWidth={2} color={earned ? "var(--paper)" : "var(--ink-soft)"} />
          </g>
        </g>
      </g>
    </svg>
  );
}
