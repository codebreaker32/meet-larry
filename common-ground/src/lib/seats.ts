import type { GroupBridge, GroupMember } from "@/lib/contracts";
import { normalizeSeatColor, seatColorAt } from "@/lib/tokens";

/** The member's own seat colour, or the seat token for their place in the room (SEAT_COLORS order). */
export function seatColor(members: Pick<GroupMember, "id" | "color">[], id: string): string {
  const i = members.findIndex((m) => m.id === id);
  const own = members[i]?.color;
  return own ? normalizeSeatColor(own) : seatColorAt(Math.max(0, i));
}

/** "Sam", "Sam and Priya", "Sam, Priya and Alex". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** Titles like "Your Name." already end the sentence. */
export const endSentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);

export interface ReasonLine {
  /** Member ids the line is about: one seat marker each. */
  ids: string[];
  text: string;
}

/**
 * Easy-read reason lines for a group bridge, one per pick: "Sam likes Minecraft." or, when two or
 * more people's picks are the same, "Sam and Priya like Spirited Away." Strongest picks first,
 * at most two per person.
 */
export function groupBridgeLines(bridge: GroupBridge, members: Pick<GroupMember, "id" | "name">[]): ReasonLine[] {
  const byPick = new Map<string, string[]>();
  for (const m of members) {
    for (const pick of (bridge.from[m.id] ?? []).slice(0, 2)) {
      const ids = byPick.get(pick) ?? [];
      if (!ids.includes(m.id)) ids.push(m.id);
      byPick.set(pick, ids);
    }
  }
  const name = (id: string) => members.find((m) => m.id === id)?.name ?? "Someone";
  const lines = [...byPick.entries()]
    // Picks more people share come first.
    .sort((a, b) => b[1].length - a[1].length)
    .map(([pick, ids]) => ({
      ids,
      text: endSentence(`${joinNames(ids.map(name))} ${ids.length > 1 ? "like" : "likes"} ${pick}`),
    }));
  return lines.length ? lines : [{ ids: [], text: "Fits your group's tastes." }];
}

/** The members whose tastes point to a bridge. */
export const bridgeMemberIds = (bridge: GroupBridge) =>
  Object.entries(bridge.from)
    .filter(([, picks]) => picks.length > 0)
    .map(([id]) => id);
