import { SeatMarks } from "@/components/bridge-card";
import { Poster } from "@/components/taste-card";
import type { GroupMember } from "@/lib/contracts";
import type { TasteItem } from "@/lib/types";
import { joinNames, seatColor } from "@/lib/seats";

/** Something two or more people both picked, as a small dealt card: an ink frame, the poster and who picked it. */
export function SharedPickCard({ item, memberIds, members }: { item: TasteItem; memberIds: string[]; members: GroupMember[] }) {
  const names = memberIds.map((id) => members.find((m) => m.id === id)?.name).filter((n): n is string => !!n);
  const everyone = names.length === members.length && names.length > 1;
  return (
    <article className="flex gap-3 rounded-mini border-(length:--border-frame) border-ink bg-paper p-2.5 shadow-mini">
      <Poster item={item} className="h-20 w-14 shrink-0 lg:h-[6rem] lg:w-[4.4rem]" sizes="72px" />
      <div className="min-w-0 flex-1 py-0.5">
        <h3 className="font-display text-body font-black leading-tight">{item.name}</h3>
        <p className="mt-1.5 flex items-start gap-2 text-label font-bold leading-snug">
          <SeatMarks colors={memberIds.map((id) => seatColor(members, id))} />
          {everyone ? "You all picked this." : `${joinNames(names)} picked this.`}
        </p>
      </div>
    </article>
  );
}
