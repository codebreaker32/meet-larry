"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonStyles } from "@/components/link-button";
import { LarryAvatar } from "@/components/larry-avatar";
import { QuestCard } from "@/components/quest-card";
import { Stamp } from "@/components/ui";
import { APP_NAME } from "@/lib/brand";
import { type HomeState, progressLine } from "@/lib/next-move";
import { nameQuest } from "@/lib/quests";
import { STAGE_VISITS, TITLES } from "@/lib/titles";
import type { NextMove } from "@/lib/types/next-move";
import type { SharedItem } from "@/lib/types/witty";
import { cn } from "@/lib/utils";
import { saveQuest } from "./use-home-state";
import { useLarryLine } from "./use-larry-line";

/** The real things a move rests on, for Larry's fresh line. None: Larry keeps the fixed line. */
function evidenceItems(move: NextMove, state: HomeState): SharedItem[] {
  if (move.kind !== "weekly" || move.backOff) return [];
  if (state.matchDay?.fixture && move.title.startsWith(state.matchDay.fixture.teams)) return [{ name: state.matchDay.team, kind: "team" }];
  const items: SharedItem[] = [];
  if (move.evidence?.placeName) items.push({ name: move.evidence.placeName, kind: "place" });
  if (move.evidence?.item) items.push({ name: move.evidence.item.name, kind: "pick" });
  return items;
}

/** The view: one card, one step. Split from the data hook so it can be shown with any state. */
export function NextMoveView({
  move,
  state,
  onTake,
  onSkip,
  onSmaller,
  variant = "card",
  headingRef,
  className,
}: {
  move: NextMove;
  state: HomeState;
  onTake?: () => void;
  onSkip?: () => void;
  /** Shown as "Something smaller" when Larry has a smaller step ready. */
  onSmaller?: () => void;
  /** "sheet": inside the next-move popup, whose own title names it (no frame, no label row). */
  variant?: "card" | "sheet";
  headingRef?: React.Ref<HTMLHeadingElement>;
  className?: string;
}) {
  const sheet = variant === "sheet";
  const Heading = sheet ? "h3" : "h2";
  const fallback = { line: move.why, plain: move.plainWhy };
  const larry = useLarryLine("nudge", evidenceItems(move, state), fallback);
  const quest = move.kind === "weekly" && !move.backOff && state.quest && move.title === state.quest.name ? state.quest : undefined;

  // Larry names the month's quest once, from its real place (Return) or the kind of place (Explore).
  const questItems: SharedItem[] = quest && !quest.named ? (quest.placeName ? [{ name: quest.placeName, kind: "place" }] : []) : [];
  const questName = useLarryLine("quest", questItems, { line: quest?.name ?? "", plain: quest?.goalLine ?? "" });
  React.useEffect(() => {
    if (quest && !quest.named && questName.fresh) saveQuest(nameQuest(quest, questName.line));
  }, [quest, questName]);

  const p = move.progress;
  const nextAt = p ? STAGE_VISITS[p.stage] : 0;
  const ProgressIcon = p ? TITLES[p.stage].Icon : null;

  return (
    <section
      aria-labelledby="next-move-title"
      data-testid="next-move"
      data-kind={move.kind}
      className={cn("flex flex-col gap-4", !sheet && "rounded-panel border-2 border-ink bg-paper p-5 shadow-panel sm:p-6", className)}
    >
      {!sheet && (
        <p className="flex items-center gap-2 text-label font-bold text-ink-soft">
          <LarryAvatar size="sm" decorative /> {APP_NAME}&apos;s next move
        </p>
      )}
      <Heading
        id="next-move-title"
        ref={headingRef}
        tabIndex={sheet ? -1 : undefined}
        className={cn("font-display font-black leading-tight text-ink", sheet ? "text-title-sm" : "text-title-md")}
      >
        {quest && !quest.named && questName.fresh ? questName.line : move.title}
      </Heading>

      {/* Larry's reason: an ink bubble, always labelled as an AI. */}
      <div>
        <p className="mb-1 text-label font-bold text-ink-soft">{APP_NAME} (AI pal)</p>
        <p className="max-w-measure rounded-bubble bg-ink px-4 py-2.5 text-body leading-snug text-paper" data-testid="next-move-why">
          {larry.line}
        </p>
      </div>

      {/* The quest's name is the card's heading, so the quest panel shows only the goal and progress. */}
      {quest && <QuestCard quest={quest} showName={false} />}

      {p && ProgressIcon && (
        <div className="flex flex-wrap items-center gap-2">
          <Stamp
            icon={<ProgressIcon aria-hidden />}
            pips={nextAt - p.visitsAway}
            pipsMax={nextAt}
            pipsLabel={`${nextAt - p.visitsAway} of ${nextAt} visits to ${TITLES[p.stage].word}`}
          >
            {TITLES[p.stage].word}
          </Stamp>
          <p className="text-body text-ink">{progressLine(p)}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Link href={move.cta.href} onClick={onTake} className={buttonStyles.primary}>
          {move.cta.label} <ArrowRight className="size-5" aria-hidden />
        </Link>
        {move.alternatives?.map((a) => (
          <Link key={a.href} href={a.href} onClick={onTake} className={buttonStyles.secondary}>
            {a.label}
          </Link>
        ))}
      </div>
      {/* Passing on the move is a quieter choice, on its own row, so the move itself leads. */}
      {(onSmaller || onSkip) && (
        <div className="-ml-4 -mt-2 flex flex-wrap items-center gap-x-1">
          {onSmaller && (
            <button type="button" onClick={onSmaller} className={buttonStyles.quiet}>
              Something smaller
            </button>
          )}
          {onSkip && (
            <button type="button" onClick={onSkip} className={buttonStyles.quiet}>
              Not now
            </button>
          )}
        </div>
      )}
    </section>
  );
}

