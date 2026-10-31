"use client";

import * as React from "react";
import { UserPlus } from "lucide-react";
import { Poster } from "@/components/taste-card";
import { ROOM_MAX_MEMBERS, type GroupMember } from "@/lib/contracts";
import { cn } from "@/lib/utils";

/**
 * A member's taste card at table size: the ink face, their name, a seat dot and their first four
 * picks. The seat colour also rings the card, so each person can be found in the chat and in
 * the reasons; the name is always printed too (colour is never the only sign).
 */
export function MemberCard({ member, isMe, className }: { member: GroupMember; isMe?: boolean; className?: string }) {
  const items = member.profile.items.slice(0, 4);
  return (
    <div
      className={cn("flex aspect-[5/7] w-[6.75rem] shrink-0 flex-col rounded-mini bg-ink p-2 text-paper shadow-mini ring-(length:--border-frame) ring-offset-2 ring-offset-table", className)}
      style={{ "--tw-ring-color": member.color } as React.CSSProperties}
    >
      <p className="flex min-w-0 items-center gap-1.5">
        <span aria-hidden className="size-2.5 shrink-0 rounded-full ring-2 ring-paper" style={{ background: member.color }} />
        <span className="truncate font-display text-label font-black leading-tight">{member.name}</span>
      </p>
      <p className="text-caption text-paper-soft">{isMe ? "You" : " "}</p>
      <div className="mt-1 grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-1">
        {Array.from({ length: 4 }, (_, i) =>
          items[i] ? (
            <Poster key={items[i].id} item={items[i]} className="h-full rounded-inner border-2" sizes="48px" />
          ) : (
            <span key={i} aria-hidden className="rounded-inner border-2 border-dashed border-paper-soft" />
          ),
        )}
      </div>
      <span className="sr-only">
        {isMe ? "You. " : ""}Likes {member.profile.items.map((i) => i.name).join(", ")}.
      </span>
    </div>
  );
}

/** An open seat: a dashed outline, never a filled grey box. */
export function EmptySeat({ first }: { first: boolean }) {
  return (
    <div
      aria-hidden
      className="grid aspect-[5/7] w-[6.75rem] shrink-0 place-items-center rounded-mini border-2 border-dashed border-ink-soft p-2 text-center text-caption font-bold text-ink-soft"
    >
      {first ? (
        <span className="flex flex-col items-center gap-1">
          <UserPlus className="size-5" aria-hidden />
          Free seat
        </span>
      ) : null}
    </div>
  );
}

/** Everyone in the room, then the free seats, up to five. */
export function MemberRow({
  members,
  meId,
  seats = ROOM_MAX_MEMBERS,
  className,
}: {
  members: GroupMember[];
  meId?: string;
  /** Seats in this room (an Open to meet room has two, and no free ones). */
  seats?: number;
  className?: string;
}) {
  const free = Math.max(0, seats - members.length);
  // On phones the row scrolls sideways. While it overflows it takes keyboard focus, so arrow keys
  // can scroll it (WCAG 2.1.1); on wide screens it wraps and stays out of the tab order.
  const ref = React.useRef<HTMLUListElement>(null);
  const [scrolls, setScrolls] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setScrolls(el.scrollWidth > el.clientWidth + 1);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [members.length, free]);
  return (
    <ul
      ref={ref}
      tabIndex={scrolls ? 0 : undefined}
      aria-label={`${members.length} of ${seats} people in the room`}
      className={cn("-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 pt-1.5 focus-visible:-outline-offset-3 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-1", className)}
    >
      {members.map((m) => (
        <li key={m.id}>
          <MemberCard member={m} isMe={m.id === meId} />
        </li>
      ))}
      {Array.from({ length: free }, (_, i) => (
        <li key={`free-${i}`} aria-hidden>
          <EmptySeat first={i === 0} />
        </li>
      ))}
    </ul>
  );
}
