import { Compass, RotateCcw } from "lucide-react";
import { Stamp } from "@/components/ui";
import { questDone, type Quest } from "@/lib/quests";
import { cn } from "@/lib/utils";

/**
 * This month's quest: Larry's name for it, the plain goal and progress pips. Completed only by
 * verified check-ins (src/lib/quests.ts). No countdown, no "days left", no failure state: an
 * unfinished quest simply leaves at the end of the month.
 */
export function QuestCard({ quest, showName = true, className }: { quest: Quest; showName?: boolean; className?: string }) {
  const done = questDone(quest);
  const Icon = quest.kind === "return" ? RotateCcw : Compass;
  return (
    <section
      aria-label="This month's quest"
      data-testid="quest-card"
      className={cn("flex flex-col gap-2 rounded-mini border-2 border-dashed border-ink bg-paper p-4", className)}
    >
      <p className="text-label font-bold text-ink-soft">This month&apos;s quest</p>
      {showName && <p className="font-display text-title-sm font-black leading-tight text-ink">{quest.name}</p>}
      {quest.goalLine && <p className="text-body text-ink">{quest.goalLine}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {done ? (
          <Stamp variant="done" icon={<Icon aria-hidden />}>
            Quest done
          </Stamp>
        ) : (
          <Stamp
            icon={<Icon aria-hidden />}
            pips={quest.progress}
            pipsMax={quest.goal}
            pipsLabel={`${quest.progress} of ${quest.goal} check-ins done`}
            detail={`${quest.progress} of ${quest.goal} done`}
          >
            {quest.kind === "return" ? "Return" : "Explore"}
          </Stamp>
        )}
        <p className="text-label text-ink-soft">Only check-ins at the place count.</p>
      </div>
    </section>
  );
}
