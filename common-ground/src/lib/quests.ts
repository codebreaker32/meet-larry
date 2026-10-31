// Quests: ONE real-world goal a month, named by Larry, alternating Return and Explore. Pure and
// device-only (never synced, never sent). Progress is read from the verified place counters only
// (PlaceCounter.visits counts verified visits; unverified "Visited" lives in `unverified` and never
// counts), so a quest can be completed by real check-ins and nothing else: no chat, no app opens.
// No countdowns and no "failed": an unfinished quest quietly leaves when the month ends.
import type { PlaceVibe } from "./contracts";
import type { PlaceCounter } from "./types/checkin";
import type { Quest, QuestKind } from "./types/quests";
import type { Mood } from "./types/signals";

export type { Quest, QuestKind };

/** Verified check-ins a quest asks for. Small on purpose: one quest, one month, two visits. */
export const QUEST_GOAL: Record<Exclude<QuestKind, "duo">, number> = { return: 2, explore: 2 };
/** Larry's quest names stay short enough for one line on a phone. */
export const QUEST_NAME_MAX = 40;

/** What the device keeps beside the Quest contract: the counts at the start, so progress is a real difference. */
export interface QuestRecord extends Quest {
  /** placeId -> verified visits when the quest started. Device only. */
  baseline: Record<string, number>;
  /** Return quests: the place to go back to. */
  placeId?: string;
  placeName?: string;
  /** Explore quests: the kind of place, from mood or the Ladder. */
  vibe?: PlaceVibe;
  /** True once Larry (not the fallback) named it; the name then stays for the month. */
  named?: boolean;
}

/** "YYYY-MM" in local time: a quest belongs to the person's own calendar month. */
export function monthOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const verified = (c: PlaceCounter) => Math.max(0, Math.floor(c.visits || 0));

/** The place to go back to: the one with the most verified visits (ties: the first). */
export function favouritePlace(counters: PlaceCounter[]): PlaceCounter | undefined {
  return counters.filter((c) => verified(c) > 0).reduce<PlaceCounter | undefined>((best, c) => (!best || verified(c) > verified(best) ? c : best), undefined);
}

/** Alternate each month. Return needs somewhere to return to, so a new person explores first. */
export function nextQuestKind(prev: QuestKind | undefined, counters: PlaceCounter[]): "return" | "explore" {
  const canReturn = !!favouritePlace(counters);
  if (!canReturn) return "explore";
  return prev === "explore" ? "return" : prev === "return" ? "explore" : "return";
}

/** Mood first, then the Ladder: someone already at Regular somewhere is ready for a cosier step up. */
export function questVibe(mood: Mood | undefined, counters: PlaceCounter[]): PlaceVibe {
  if (mood === "chill" || mood === "low-energy") return "calm";
  if (mood === "social" || mood === "hype") return "lively";
  if (mood === "curious") return "cosy";
  return counters.some((c) => verified(c) >= 3) ? "cosy" : "calm";
}

const VIBE_WORD: Record<PlaceVibe, string> = { calm: "calm", cosy: "cosy", lively: "lively" };

/**
 * The fixed names, used until Larry names the quest (and whenever the model can't). Each names only
 * real things: the person's own place, or the kind of place. Never a number or date it doesn't have.
 */
export function fallbackQuestName(q: Pick<QuestRecord, "kind" | "placeName" | "vibe">): string {
  if (q.kind === "return" && q.placeName) return clip(`The ${q.placeName} Round`);
  switch (q.vibe) {
    case "lively":
      return "The Lively Lap";
    case "cosy":
      return "The Cosy Corner Hunt";
    default:
      return "The Quiet Corners Tour";
  }
}

/** The plain goal line, easy-read and countdown-free. */
export function questGoalLine(q: Pick<QuestRecord, "kind" | "goal" | "placeName" | "vibe">): string {
  if (q.kind === "return" && q.placeName) return `Go back to ${q.placeName} ${q.goal} times this month.`;
  return `Try ${q.goal} new ${VIBE_WORD[q.vibe ?? "calm"]} places this month.`;
}

function clip(s: string): string {
  return s.length <= QUEST_NAME_MAX ? s : `${s.slice(0, QUEST_NAME_MAX - 1).trimEnd()}…`;
}

/** A fresh quest for this month, with today's counts as its starting line. */
export function newQuest(
  month: string,
  counters: PlaceCounter[],
  opts: { prevKind?: QuestKind; mood?: Mood } = {},
): QuestRecord {
  const kind = nextQuestKind(opts.prevKind, counters);
  const baseline: Record<string, number> = {};
  for (const c of counters) if (verified(c) > 0) baseline[c.placeId] = verified(c);
  const fav = kind === "return" ? favouritePlace(counters) : undefined;
  const base = {
    kind,
    goal: QUEST_GOAL[kind],
    month,
    baseline,
    ...(fav ? { placeId: fav.placeId, placeName: fav.placeName } : {}),
    ...(kind === "explore" ? { vibe: questVibe(opts.mood, counters) } : {}),
  };
  return {
    ...base,
    id: `${month}-${kind}`,
    name: fallbackQuestName(base),
    goalLine: questGoalLine(base),
    progress: 0,
  };
}

/**
 * Progress from verified visits since the quest began:
 * - Return: verified visits to the chosen place beyond its starting count.
 * - Explore: places with no verified visit at the start that now have one (each place counts once).
 */
export function questProgress(q: QuestRecord, counters: PlaceCounter[]): number {
  if (q.kind === "return") {
    const c = counters.find((x) => x.placeId === q.placeId);
    return c ? Math.max(0, verified(c) - (q.baseline[c.placeId] ?? 0)) : 0;
  }
  return counters.filter((c) => verified(c) > 0 && !(c.placeId in q.baseline)).length;
}

/** Brings progress up to date. It never goes down and stops at the goal. */
export function syncQuest(q: QuestRecord, counters: PlaceCounter[]): QuestRecord {
  const progress = Math.min(q.goal, Math.max(q.progress, questProgress(q, counters)));
  return progress === q.progress ? q : { ...q, progress };
}

export const questDone = (q: Pick<Quest, "progress" | "goal">) => q.progress >= q.goal;

/** Larry's name for the quest, kept only when it is short and plain; otherwise the fallback stays. */
export function nameQuest(q: QuestRecord, name: string | null | undefined): QuestRecord {
  const clean = (name ?? "").replace(/[\p{C}"“”]/gu, "").replace(/\s+/g, " ").trim();
  if (!clean || clean.length > QUEST_NAME_MAX || /https?:|www\.|@/i.test(clean)) return q;
  return { ...q, name: clean, named: true };
}

/**
 * This month's quest, from what the device holds. A new month starts a new quest (alternating the
 * kind); last month's unfinished quest simply leaves. Only the latest month is kept.
 */
export function currentQuest(stored: QuestRecord[], counters: PlaceCounter[], now: Date, opts: { mood?: Mood } = {}): QuestRecord {
  const month = monthOf(now);
  const latest = stored.reduce<QuestRecord | undefined>((a, q) => (!a || q.month > a.month ? q : a), undefined);
  if (latest && latest.month === month) return syncQuest(latest, counters);
  return syncQuest(newQuest(month, counters, { prevKind: latest?.kind, mood: opts.mood }), counters);
}

/** Reads stored quests defensively: anything malformed is dropped, never trusted. */
export function parseQuests(raw: unknown): QuestRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: QuestRecord[] = [];
  for (const q of raw) {
    if (!q || typeof q !== "object") continue;
    const r = q as Partial<QuestRecord>;
    if (r.kind !== "return" && r.kind !== "explore") continue;
    if (typeof r.month !== "string" || !/^\d{4}-\d{2}$/.test(r.month)) continue;
    if (typeof r.name !== "string" || typeof r.id !== "string") continue;
    const goal = Number.isFinite(r.goal) && (r.goal as number) > 0 ? Math.floor(r.goal as number) : QUEST_GOAL[r.kind];
    const baseline: Record<string, number> = {};
    if (r.baseline && typeof r.baseline === "object") {
      for (const [k, v] of Object.entries(r.baseline)) if (typeof v === "number" && v >= 0) baseline[k] = Math.floor(v);
    }
    out.push({
      id: r.id,
      name: r.name.slice(0, QUEST_NAME_MAX),
      kind: r.kind,
      goal,
      progress: Math.min(goal, Math.max(0, Math.floor(Number(r.progress) || 0))),
      month: r.month,
      baseline,
      ...(typeof r.goalLine === "string" ? { goalLine: r.goalLine } : {}),
      ...(typeof r.placeId === "string" ? { placeId: r.placeId } : {}),
      ...(typeof r.placeName === "string" ? { placeName: r.placeName } : {}),
      ...(r.vibe === "calm" || r.vibe === "cosy" || r.vibe === "lively" ? { vibe: r.vibe } : {}),
      ...(r.named ? { named: true } : {}),
    });
  }
  return out;
}
