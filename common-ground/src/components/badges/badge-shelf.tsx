"use client";

import { TitleBadge } from "@/components/title-badge";
import { STAGES, STAGE_VISITS, type Stage } from "@/lib/titles";
import { BADGE_IDS, type BadgeId } from "./badge-medal";

/** What the owner has earned so far, from their own data. A stage at any place earns every stage below it. */
export function earnedBadges(input: {
  glory: number;
  stages: (Stage | null | undefined)[];
  publicTitles: string[];
  friendTitles: string[];
}): Set<BadgeId> {
  const out = new Set<BadgeId>();
  if (input.glory > 0) out.add("glory");
  const best = Math.max(0, ...input.stages.map((s) => (s ? STAGE_VISITS[s] : 0)));
  for (const s of STAGES) if (STAGE_VISITS[s] <= best) out.add(s);
  for (const t of [...input.publicTitles, ...input.friendTitles]) if ((BADGE_IDS as readonly string[]).includes(t)) out.add(t as BadgeId);
  return out;
}

/**
 * The owner's badge shelf: all 13, earned ones in colour, the rest in outline. Owner only (it shows
 * private stages). Each opens its meaning. No counts, no rarity, nothing to lose.
 */
export function BadgeShelf({ earned, className }: { earned: Set<BadgeId>; className?: string }) {
  return (
    <ul className={className ?? "grid grid-cols-3 gap-x-1 gap-y-3 md:grid-cols-5"} aria-label="Your badges">
      {BADGE_IDS.map((id) => (
        <li key={id} className="flex justify-center">
          <TitleBadge id={id} size="md" layout="stack" earned={earned.has(id)} info />
        </li>
      ))}
    </ul>
  );
}
