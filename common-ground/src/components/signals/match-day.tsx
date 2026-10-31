"use client";

import { CalendarClock, Trophy, Tv } from "lucide-react";
import { Badge } from "@/components/ui";
import { HIGHLIGHTS_PLAN_B, matchDayFallback, SCREEN_LINE } from "@/lib/matchday";
import { cn } from "@/lib/utils";

/** "Match Day" on a bridge card, when the people at the table picked the same team or player. */
export function MatchDayBadge() {
  return (
    <Badge variant="paper" icon={<Trophy className="size-3" />}>
      Match Day
    </Badge>
  );
}

/** What a Match Day ticket needs from the server: a sourced fixture, or none (then the honest fallback). */
export interface MatchDayTicketInfo {
  /** The team or player from the group's own picks. */
  team?: string;
  /** Only a hand-verified fixture (src/lib/matchday.ts validFixture). Never invented. */
  fixture?: { teams: string; when: string; source: string };
}

/**
 * The Match Day lines on a Plan Ticket: the sourced fixture ("Fixture: <source>. Larry never guesses
 * kickoff times."), or the honest off-season line; then the screen line (Larry never claims a TV)
 * and the highlights plan B.
 */
export function MatchDayTicketLines({ info, className }: { info: MatchDayTicketInfo; className?: string }) {
  const f = info.fixture;
  return (
    <div className={cn("flex flex-col gap-2 rounded-mini border-2 border-ink bg-table p-3", className)} data-testid="matchday-lines">
      <p className="flex items-center gap-2 font-bold">
        <Trophy className="size-5 shrink-0" aria-hidden /> Match Day
      </p>
      {f ? (
        <p className="flex items-start gap-2 text-body leading-snug" data-testid="matchday-fixture">
          <CalendarClock className="mt-0.5 size-5 shrink-0" aria-hidden />
          <span>
            <span className="font-bold">
              {f.teams}, {f.when}.
            </span>{" "}
            Fixture: {f.source}. Larry never guesses kickoff times.
          </span>
        </p>
      ) : (
        <p className="text-body leading-snug" data-testid="matchday-fallback">
          {matchDayFallback(info.team).line}
        </p>
      )}
      <p className="flex items-start gap-2 text-label leading-snug">
        <Tv className="mt-0.5 size-4 shrink-0" aria-hidden />
        {SCREEN_LINE}
      </p>
      {f && <p className="text-label leading-snug text-ink-soft">{HIGHLIGHTS_PLAN_B}</p>}
    </div>
  );
}
