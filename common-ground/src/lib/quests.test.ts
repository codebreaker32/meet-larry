import { describe, expect, it } from "vitest";
import {
  currentQuest,
  fallbackQuestName,
  monthOf,
  nameQuest,
  newQuest,
  nextQuestKind,
  parseQuests,
  questDone,
  questGoalLine,
  questProgress,
  syncQuest,
} from "./quests";
import type { PlaceCounter } from "./types/checkin";

const counter = (placeId: string, visits: number, extra: Partial<PlaceCounter> = {}): PlaceCounter => ({
  placeId,
  placeName: placeId === "dice" ? "Dice and Tea" : `Place ${placeId}`,
  visits,
  weeksBits: "1",
  totalWeeks: 1,
  lastIsoWeek: "2026-W44",
  stage: null,
  spotWeeks: visits > 0 ? 1 : 0,
  ...extra,
});

const OCT = new Date(2026, 9, 31, 12);
const NOV = new Date(2026, 10, 2, 12);

describe("quests", () => {
  it("uses the local calendar month", () => {
    expect(monthOf(OCT)).toBe("2026-10");
    expect(monthOf(NOV)).toBe("2026-11");
  });

  it("starts a new person on Explore, then alternates Return and Explore", () => {
    expect(nextQuestKind(undefined, [])).toBe("explore");
    expect(nextQuestKind("return", [])).toBe("explore"); // nowhere to return to yet
    const been = [counter("dice", 2)];
    expect(nextQuestKind("explore", been)).toBe("return");
    expect(nextQuestKind("return", been)).toBe("explore");
  });

  it("Return goes back to the most-visited place, with a plain, countdown-free goal line", () => {
    const q = newQuest("2026-10", [counter("a", 1), counter("dice", 4)], { prevKind: "explore" });
    expect(q.kind).toBe("return");
    expect(q.placeName).toBe("Dice and Tea");
    expect(q.name).toBe("The Dice and Tea Round");
    expect(q.goalLine).toBe("Go back to Dice and Tea 2 times this month.");
    expect(q.goalLine).not.toMatch(/days? left|expires|hurry/i);
  });

  it("Explore names a kind of place from mood or the Ladder, never a made-up venue", () => {
    const q = newQuest("2026-10", [], { mood: "chill" });
    expect(q.vibe).toBe("calm");
    expect(fallbackQuestName(q)).toBe("The Quiet Corners Tour");
    expect(questGoalLine(q)).toBe("Try 2 new calm places this month.");
    expect(newQuest("2026-10", [], { mood: "hype" }).vibe).toBe("lively");
  });

  it("completes only from verified check-ins: unverified visits never count", () => {
    const start = [counter("dice", 3)];
    const q = newQuest("2026-10", start, { prevKind: "explore" });
    // Two "Visited" (no verified leave) at the place: no progress.
    expect(questProgress(q, [counter("dice", 3, { unverified: 2 })])).toBe(0);
    // One verified visit: 1 of 2.
    const one = syncQuest(q, [counter("dice", 4)]);
    expect(one.progress).toBe(1);
    expect(questDone(one)).toBe(false);
    const two = syncQuest(one, [counter("dice", 5)]);
    expect(questDone(two)).toBe(true);
  });

  it("Explore counts each new place once, and unverified new places not at all", () => {
    const q = newQuest("2026-10", [counter("dice", 2)], { prevKind: "return" });
    expect(q.kind).toBe("explore");
    const later = [counter("dice", 5), counter("b", 0, { unverified: 1 }), counter("c", 3)];
    expect(questProgress(q, later)).toBe(1);
  });

  it("progress never goes down and stops at the goal", () => {
    const q = { ...newQuest("2026-10", [counter("dice", 1)], { prevKind: "explore" }), progress: 2 };
    expect(syncQuest(q, []).progress).toBe(2);
    expect(syncQuest({ ...q, progress: 0 }, [counter("dice", 9)]).progress).toBe(2);
  });

  it("a new month starts a new quest; last month's unfinished one quietly leaves", () => {
    const oct = currentQuest([], [counter("dice", 1)], OCT);
    expect(oct.month).toBe("2026-10");
    const same = currentQuest([oct], [counter("dice", 2)], OCT);
    expect(same.id).toBe(oct.id);
    const nov = currentQuest([same], [counter("dice", 2)], NOV);
    expect(nov.month).toBe("2026-11");
    expect(nov.kind).not.toBe(oct.kind);
    expect(nov.progress).toBe(0);
  });

  it("keeps Larry's name only when it is short and plain", () => {
    const q = newQuest("2026-10", [], {});
    expect(nameQuest(q, "The Board Game Pilgrimage").name).toBe("The Board Game Pilgrimage");
    expect(nameQuest(q, "The Board Game Pilgrimage").named).toBe(true);
    expect(nameQuest(q, "x".repeat(80)).name).toBe(q.name);
    expect(nameQuest(q, "visit https://spam.example").name).toBe(q.name);
    expect(nameQuest(q, "").name).toBe(q.name);
  });

  it("parses stored quests defensively", () => {
    const q = newQuest("2026-10", [counter("dice", 1)], { prevKind: "explore" });
    expect(parseQuests([q])).toEqual([q]);
    expect(parseQuests("nope")).toEqual([]);
    expect(parseQuests([{ kind: "duo", month: "2026-10", name: "x", id: "y" }])).toEqual([]);
    expect(parseQuests([{ ...q, progress: 99 }])[0].progress).toBe(q.goal);
  });
});
