"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { HiddenGemBadge, isLessKnown } from "@/components/signals/less-known-badge";
import { Poster } from "@/components/taste-card";
import { bridgeMemberIds, groupBridgeLines, joinNames, seatColor } from "@/lib/seats";
import { Badge, Skeleton } from "@/components/ui";
import { APP_NAME } from "@/lib/brand";
import type { GroupBridge } from "@/lib/contracts";
import { DOMAIN_STYLE } from "@/lib/domain-style";
import type { Bridge } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Easy-read reason lines: "Sam likes Minecraft." / "Priya likes Fleet Foxes." or "You both like Spirited Away." */
export function bridgeLines(bridge: Bridge, aName: string, bName: string): { who: "a" | "b" | "both"; text: string }[] {
  const both = bridge.fromA.filter((n) => bridge.fromB.includes(n));
  const onlyA = bridge.fromA.filter((n) => !both.includes(n)).slice(0, 2);
  const onlyB = bridge.fromB.filter((n) => !both.includes(n)).slice(0, 2);
  const list = (names: string[]) => names.join(" and ");
  // Titles like "Your Name." already end the sentence, so don't add a second full stop.
  const end = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);
  const lines: { who: "a" | "b" | "both"; text: string }[] = [];
  if (both.length) lines.push({ who: "both", text: end(`You both like ${list(both.slice(0, 2))}`) });
  if (onlyA.length) lines.push({ who: "a", text: end(`${aName} likes ${list(onlyA)}`) });
  if (onlyB.length) lines.push({ who: "b", text: end(`${bName} likes ${list(onlyB)}`) });
  return lines.length ? lines : [{ who: "both", text: "Fits both your tastes." }];
}

export function bridgeReason(bridge: Bridge, aName: string, bName: string): string {
  return bridgeLines(bridge, aName, bName)
    .map((l) => l.text)
    .join(" ");
}

/** Easy-read "why": who the people are who like these picks, and whose pick counted more. */
export function whyText(bridge: Bridge, aName: string, bName: string): string[] {
  const fans = [...new Set([...bridge.fromA.slice(0, 1), ...bridge.fromB.slice(0, 1)])];
  const lines = [
    fans.length
      ? `People who like ${fans.join(" and ")} also like ${bridge.name}.`
      : `People with tastes like yours also like ${bridge.name}.`,
  ];
  const { scoreA, scoreB } = bridge;
  if (bridge.fromA.length && bridge.fromB.length && scoreA != null && scoreB != null && scoreA > 0 && scoreB > 0) {
    const ratio = Math.max(scoreA, scoreB) / Math.min(scoreA, scoreB);
    const who = scoreA > scoreB ? aName : bName;
    if (ratio < 1.1) lines.push("Both picks counted about the same.");
    else lines.push(`${who}'s pick counted ${ratio < 1.5 ? "a little more" : "more"}.`);
  }
  return lines;
}

/**
 * Larry's reason a bridge fits, without a leading "Name:" (the title is already above it) and
 * ending in a full stop. Empty when Larry gave none.
 */
export function cleanWhy(bridge: { name: string; why?: string }): string {
  let why = (bridge.why ?? "").trim();
  if (!why) return "";
  const lead = `${bridge.name}:`;
  if (why.toLowerCase().startsWith(lead.toLowerCase())) why = why.slice(lead.length).trim();
  if (!why) return "";
  why = why.charAt(0).toUpperCase() + why.slice(1);
  return /[.!?]$/.test(why) ? why : `${why}.`;
}

/** A person at the table. Their seat colour marks the reason lines about them (with their name in words). */
export interface Seat {
  id: string;
  name: string;
  /** A seat token, "var(--seat-1)" (SEAT_COLORS in @/lib/tokens). */
  color: string;
}

/** One reason line and the seat colours of the people it is about (none: an ink bar, about everyone). */
type ReasonLine = { colors: string[]; text: string };

const isGroup = (bridge: Bridge | GroupBridge): bridge is GroupBridge => "from" in bridge;

/** Reason lines and "Why this?" lines for a pair (Bridge, seats a and b) or a group (GroupBridge). */
function bridgeCopy(bridge: Bridge | GroupBridge, people: Seat[]): { lines: ReasonLine[]; why: string[] } {
  if (isGroup(bridge)) {
    return {
      lines: groupBridgeLines(bridge, people).map((l) => ({ colors: l.ids.map((id) => seatColor(people, id)), text: l.text })),
      why: groupWhyText(bridge, people),
    };
  }
  const [a, b] = people;
  const aName = a?.name ?? "Someone";
  const bName = b?.name ?? "Someone";
  const seat = { a: [a?.color ?? "var(--ink)"], b: [b?.color ?? "var(--ink)"], both: [a, b].filter(Boolean).map((p) => p!.color) };
  return {
    lines: bridgeLines(bridge, aName, bName).map((l) => ({ colors: seat[l.who], text: l.text })),
    why: whyText(bridge, aName, bName),
  };
}

/** "People who like Minecraft and Fleet Foxes also like Stardew Valley." "It fits Sam, Priya and Alex." */
function groupWhyText(bridge: GroupBridge, people: Pick<Seat, "id" | "name">[]): string[] {
  const ids = bridgeMemberIds(bridge);
  const picks = [...new Set(ids.map((m) => bridge.from[m]?.[0]).filter((p): p is string => !!p))].slice(0, 3);
  const names = ids.map((m) => people.find((x) => x.id === m)?.name).filter((n): n is string => !!n);
  return [
    picks.length
      ? `People who like ${joinNames(picks)} also like ${bridge.name}.`
      : `People with tastes like yours also like ${bridge.name}.`,
    ...(names.length > 1 ? [`It fits ${joinNames(names)}.`] : []),
  ];
}

/** Seat markers for the people a line is about: one short bar each in their seat colour, or one ink bar. */
export function SeatMarks({ colors }: { colors: string[] }) {
  return (
    <span aria-hidden className="mt-[0.3rem] flex shrink-0 gap-0.5">
      {colors.length === 0 ? (
        <span className="h-3 w-1.5 rounded-full bg-ink" />
      ) : (
        colors.map((c, i) => <span key={c + i} className="h-3 w-1.5 rounded-full" style={{ background: c }} />)
      )}
    </span>
  );
}

/**
 * The one bridge card, for a pair (a `Bridge` and two seats, a then b) and a room (a `GroupBridge`
 * and 2 to 5 seats). Paper, a category frame and poster, Larry's reason, then one easy-read reason
 * line per pick with a seat marker for each person behind it. Reasons are never cut off.
 */
export function BridgeCard({
  bridge,
  people,
  best = false,
  hiddenGem,
  badge,
  className,
}: {
  bridge: Bridge | GroupBridge;
  /** The people at the table, 2 to 5. For a pair Bridge, seat a then seat b. */
  people: Seat[];
  /** The first card in fit order. Only one card is marked. */
  best?: boolean;
  /**
   * "Hidden gem" shows only when the SERVER marked this bridge less known (Qloo applied the filter
   * and returned it under LESS_KNOWN_MAX: `lessKnown` on the bridge). Pass false to hide it; true
   * alone never shows it, so the badge is never a guess from the request.
   */
  hiddenGem?: boolean;
  /** A signal badge from src/components/signals (e.g. <MatchDayBadge/>), shown beside the others. */
  badge?: React.ReactNode;
  className?: string;
}) {
  const { label, color, Icon } = DOMAIN_STYLE[bridge.domain];
  const why = cleanWhy(bridge);
  const { lines, why: evidence } = bridgeCopy(bridge, people);
  const gem = hiddenGem !== false && isLessKnown(bridge);
  return (
    <article
      className={cn("flex gap-3 rounded-mini border-(length:--border-frame) bg-paper p-2.5 shadow-mini", className)}
      style={{ borderColor: color }}
    >
      <Poster item={bridge} className="h-20 w-14 shrink-0 lg:h-[6rem] lg:w-[4.4rem]" sizes="72px" />
      <div className="min-w-0 flex-1 py-0.5">
        <p className="flex items-center gap-1.5 text-caption font-bold text-ink-soft">
          <Icon className="size-3.5 shrink-0" aria-hidden style={{ color }} /> {label}
          {(best || gem || badge) && (
            <span className="ml-auto flex flex-wrap justify-end gap-1">
              {badge}
              {gem && <HiddenGemBadge />}
              {best && <Badge>Best fit</Badge>}
            </span>
          )}
        </p>
        <h3 className="font-display text-body font-black leading-tight">{bridge.name}</h3>
        {why && (
          // Larry's specific reason this fits them leads; the Qloo picks behind it follow.
          <p className="mt-1 text-body font-bold leading-snug text-ink">{why}</p>
        )}
        <ul className="mt-1.5 flex flex-col gap-1">
          {lines.map((l) => (
            <li key={l.text} className="flex items-start gap-2 text-label leading-snug text-ink">
              <SeatMarks colors={l.colors} />
              {l.text}
            </li>
          ))}
        </ul>
        <WhyThis evidence={evidence} larryWrote={!!bridge.why} />
      </div>
    </article>
  );
}

/**
 * The bridge card while common ground is on its way: the same frame, poster window and three text
 * lines in --line, so nothing jumps when the real cards are dealt. Still (no pulse loop) and hidden
 * from screen readers: wrap the list in a `SkeletonGroup` or put a status line beside it that says
 * what is loading ("Asking Qloo what your cards share.").
 */
export function BridgeCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      data-skeleton="bridge"
      className={cn("flex min-h-[8.5rem] gap-3 rounded-mini border-(length:--border-frame) border-line bg-paper p-2.5", className)}
    >
      <Skeleton shape="block" className="h-20 w-14 lg:h-[6rem] lg:w-[4.4rem]" />
      <span className="flex flex-1 flex-col gap-2 py-1">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="w-4/5" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/4" />
      </span>
    </div>
  );
}

/** "Why this?": the Qloo evidence behind a bridge, in plain words, one tap away. */
function WhyThis({ evidence, larryWrote }: { evidence: string[]; larryWrote: boolean }) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  return (
    <div className="mt-0.5">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        // 48px to tap, but it takes less room in the card than it reaches.
        className="press press-flat -mb-2.5 -ml-2 -mt-2 flex min-h-12 items-center gap-1 rounded-full px-2 text-label font-bold text-ink underline decoration-2 underline-offset-4 hover:bg-table"
      >
        Why this?
        <ChevronDown className={cn("size-4 transition-transform duration-(--dur-quick)", open && "rotate-180")} aria-hidden />
      </button>
      <div id={id} hidden={!open} className="mt-1.5 rounded-tile bg-table p-2.5 text-label leading-snug text-ink">
        <p>{APP_NAME} looks at what real people who share your picks also love.</p>
        {larryWrote && <p className="mt-1">{APP_NAME}, the AI, wrote the short reason from what it found.</p>}
        {evidence.map((line) => (
          <p key={line} className="mt-1">
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}
