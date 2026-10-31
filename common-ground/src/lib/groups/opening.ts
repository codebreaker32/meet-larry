// Larry's opening message when a group forms (D25, D26; the flavour gate in next-round-queue.md).
// Grounded: every name in it comes from Qloo's common ground for these exact cards. Larry's judgement:
// the bridges are the ones Larry curated (findGroupCommonGround with curation), with Larry's own
// "why". Then at most ONE extra (Match Day > a shared pick > "Dig deeper") and an easy opener from
// the witty engine, all under OPENING_WORDS_MAX words. Pure: no I/O, so it is easy to test.
import type { GroupBridge, GroupGround } from "../contracts";
import type { Domain } from "../types";
import { OPENING_WORDS_MAX } from "./shared";

export interface OpeningMember {
  id: string;
  name: string;
}

export type OpeningExtra = "matchday" | "shared" | "dig";

export interface OpeningParts {
  greeting: string;
  main: string;
  extra?: string;
  extraKind?: OpeningExtra;
  opener: string;
  close: string;
}

const SPORTS: Domain[] = ["sports_team", "athlete"];

export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** "Sam", "Sam and Priya", "Sam, Priya and Ana". */
export function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** "Sam's Minecraft and Priya's Stardew Valley": whose picks led to a bridge, from Qloo's explainability. */
export function whoseLine(b: Pick<GroupBridge, "from">, members: OpeningMember[]): string {
  // The same pick from two people reads once: "Priya and Alex's Fleet Foxes".
  const byPick = new Map<string, string[]>();
  for (const m of members) {
    const pick = b.from[m.id]?.[0];
    if (pick) byPick.set(pick, [...(byPick.get(pick) ?? []), m.name]);
  }
  const parts = [...byPick].map(([pick, names]) => `${nameList(names)}'s ${pick}`).slice(0, 3);
  return nameList(parts);
}

/** The bridge Larry leads with: the first one (Larry's order when curated, else Qloo's ranking). */
export function leadBridge(ground: GroupGround | undefined): GroupBridge | undefined {
  return ground?.bridges.find((b) => Object.keys(b.from).length >= 2);
}

/**
 * A sports team or player at least two of them picked: the Match Day hook. Never a Qloo bridge,
 * because a bridge is a suggestion nobody picked, and Larry must not say they "share" it.
 */
export function sharedTeam(ground: GroupGround | undefined): string | undefined {
  return ground?.shared.find((x) => SPORTS.includes(x.item.domain) && x.memberIds.length >= 2)?.item.name;
}

/**
 * The parts of the opening, before the word cap. `openerLine` is the witty engine's opener (model or
 * its fixed fallback), about the lead item.
 */
export function openingParts(members: OpeningMember[], ground: GroupGround | undefined, openerLine: string): OpeningParts {
  const names = nameList(members.map((m) => m.name));
  const greeting = `Hi ${names}, I'm Larry, an AI pal.`;
  const bridge = leadBridge(ground);
  const shared = ground?.shared.find((s) => s.memberIds.length >= 2);
  const team = sharedTeam(ground);
  const love = members.length > 2 ? "you'd all love" : "you'd both love";
  const opener = `Easy opener: "${openerLine.replace(/"/g, "'").trim()}"`;
  const close = "Tap @Larry when you want a plan.";

  let main: string;
  if (bridge) {
    const whose = whoseLine(bridge, members);
    const why = bridge.why?.trim().replace(/\.$/, "");
    const picks = new Set(members.map((m) => bridge.from[m.id]?.[0]).filter(Boolean)).size;
    const point = picks > 2 ? "all point" : picks === 2 ? "both point" : "points";
    const from = whose ? ` ${whose} ${point} there.` : "";
    main = `I found something ${love}: ${bridge.name}.${from}${why ? ` ${why}.` : ""}`;
  } else if (shared) {
    const who = nameList(members.filter((m) => shared.memberIds.includes(m.id)).map((m) => m.name));
    main = `${who} ${shared.memberIds.length > 2 ? "all" : "both"} picked ${shared.item.name}. That's a real place to start.`;
  } else {
    main = "I didn't find a clear overlap yet, which just means more to discover.";
  }

  // At most one extra: Match Day, then a shared pick (when the main line was a bridge), then "Dig deeper".
  let extra: string | undefined;
  let extraKind: OpeningExtra | undefined;
  if (team) {
    extra = `You share ${team}. Try /matchday for a calm place to watch a game.`;
    extraKind = "matchday";
  } else if (bridge && shared && !main.includes(shared.item.name)) {
    // Only when it adds something: a pick the bridge line already named would read twice.
    const who = nameList(members.filter((m) => shared.memberIds.includes(m.id)).map((m) => m.name));
    extra = `Also, ${who} ${shared.memberIds.length > 2 ? "all" : "both"} picked ${shared.item.name}.`;
    extraKind = "shared";
  } else if (bridge || shared) {
    extra = "Want less-known picks? Try /gems.";
    extraKind = "dig";
  }
  return { greeting, main, ...(extra ? { extra, extraKind } : {}), opener, close };
}

/**
 * Joins the parts under the word cap: drops the close, then the extra, then shortens the main line
 * to Qloo's bare fact. Never cuts a sentence in half.
 */
export function composeOpening(parts: OpeningParts, max = OPENING_WORDS_MAX): { text: string; extraKind?: OpeningExtra } {
  const tries: { list: (string | undefined)[]; extra: boolean }[] = [
    { list: [parts.greeting, parts.main, parts.extra, parts.opener, parts.close], extra: true },
    { list: [parts.greeting, parts.main, parts.extra, parts.opener], extra: true },
    { list: [parts.greeting, parts.main, parts.opener], extra: false },
    { list: [parts.greeting, parts.main.split(/(?<=\.)\s+/)[0], parts.opener], extra: false },
    { list: [parts.greeting, parts.opener], extra: false },
  ];
  for (const t of tries) {
    const text = t.list.filter(Boolean).join(" ");
    if (wordCount(text) <= max) return { text, ...(t.extra && parts.extraKind ? { extraKind: parts.extraKind } : {}) };
  }
  return { text: [parts.greeting, "What have you been into lately?"].join(" ") };
}

/** The item the opener should be about: the lead bridge, else the first shared pick. */
export function openerItem(ground: GroupGround | undefined): { name: string; kind: "bridge" | "pick" } | undefined {
  const b = leadBridge(ground);
  if (b) return { name: b.name, kind: "bridge" };
  const s = ground?.shared[0];
  return s ? { name: s.item.name, kind: "pick" } : undefined;
}

/** "/together": the same common ground, without the greeting. */
export function togetherText(members: OpeningMember[], ground: GroupGround | undefined, openerLine: string): string {
  const p = openingParts(members, ground, openerLine);
  const lines = [p.main];
  const others = (ground?.bridges ?? []).filter((b) => b !== leadBridge(ground) && Object.keys(b.from).length >= 2).slice(0, 2);
  for (const b of others) lines.push(`${b.name}, from ${whoseLine(b, members)}.`);
  lines.push(p.opener);
  const text = lines.join(" ");
  return wordCount(text) <= OPENING_WORDS_MAX ? text : [p.main, p.opener].join(" ");
}
