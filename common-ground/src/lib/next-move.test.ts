import { describe, expect, it } from "vitest";
import type { PlanTicket } from "./contracts";
import { GROUP_START_HREF, type HomeState, isRestWeek, nextMove, progressLine, ticketIsToday, weeklyMove } from "./next-move";
import { newQuest } from "./quests";
import type { PlaceCounter } from "./types/checkin";

// Saturday 31 Oct 2026, noon (ISO week 2026-W44).
const NOW = new Date(2026, 9, 31, 12);

const counter = (placeId: string, visits: number, extra: Partial<PlaceCounter> = {}): PlaceCounter => ({
  placeId,
  placeName: "Dice and Tea",
  visits,
  weeksBits: "1",
  totalWeeks: 1,
  lastIsoWeek: "2026-W44",
  stage: visits >= 1 ? "rookie" : null,
  spotWeeks: visits > 0 ? 1 : 0,
  ...extra,
});

const ticket = (when: string): PlanTicket => ({
  place: { id: "dice", name: "Dice and Tea", affinity: 0, tags: ["Calm"], fits: [] },
  when,
  opener: "Have you played Cascadia?",
});

const base: HomeState = {
  hasCard: true,
  fingerprintSeen: true,
  peopleMet: 1,
  counters: [counter("dice", 1)],
  ignoredMoves: [],
  isAdult: true,
  source: "web",
};

const all = (s: Partial<HomeState>) => nextMove({ ...base, ...s }, NOW);

describe("nextMove: one move for each journey state", () => {
  it("1. no card: make the card", () => {
    expect(all({ hasCard: false }).kind).toBe("make-card");
    expect(all({ hasCard: false }).cta.href).toBe("/create");
  });

  it("2. card, Fingerprint unseen: the Fingerprint", () => {
    expect(all({ fingerprintSeen: false }).kind).toBe("fingerprint");
  });

  it("3. adults: start a group and show the QR, with Pick a pal and Open to meet as the other ways", () => {
    const m = all({ peopleMet: 0 });
    expect(m.kind).toBe("second-person");
    expect(m.title).toBe("Start a group and show the QR");
    expect(m.cta.href).toBe(GROUP_START_HREF);
    expect(m.alternatives?.map((a) => a.label)).toEqual(["Pick a pal first", "Open to meet"]);
  });

  it("3. under 18 or unknown age: device-only, no group and no Open to meet anywhere", () => {
    const m = all({ peopleMet: 0, isAdult: false });
    expect(m.kind).toBe("warm-up");
    expect(m.cta.href).toBe("/practice");
    const links = [m.cta.href, ...(m.alternatives ?? []).map((a) => a.href)].join(" ");
    expect(links).not.toMatch(/group|meet/);
  });

  it("4. met people, never checked in: a Plan Ticket at a place that fits the mood", () => {
    const m = all({ counters: [], mood: "low-energy" });
    expect(m.kind).toBe("plan");
    expect(m.prompt).toBe("facilitator");
    expect(m.cta.href).toBe("/larry?ask=place&vibe=calm");
    expect(m.why).toMatch(/Twenty minutes/);
    expect(all({ counters: [], mood: "social" }).cta.href).toContain("vibe=lively");
  });

  it("5. an open ticket on another day: one reminder, with the opener", () => {
    const m = all({ openTicket: ticket("Mon 4pm") });
    expect(m.kind).toBe("reminder");
    expect(m.prompt).toBe("signal");
    expect(m.why).toContain("Have you played Cascadia?");
  });

  it("6. today's ticket: check in, with progress to the next title and the friend title in reach", () => {
    const m = all({ openTicket: ticket("Sat 11am"), rivalry: { placeId: "dice", title: "party-leader", visitsAway: 1 } });
    expect(m.kind).toBe("check-in");
    expect(m.progress).toEqual({ stage: "regular", visitsAway: 2, friendTitle: { title: "party-leader", visitsAway: 1 } });
    expect(progressLine(m.progress)).toBe("Regular is 2 visits away. Party Leader is 1 visit away too.");
  });

  it("6. mid-visit comes first: finish the check-in", () => {
    const m = all({ openVisit: { placeId: "dice", placeName: "Dice and Tea" }, openTicket: ticket("Mon 4pm") });
    expect(m.kind).toBe("check-in");
    expect(m.title).toBe("Finish your check-in at Dice and Tea");
  });

  it("7. weekly: Match Day (verified fixture) beats the quest", () => {
    const quest = newQuest("2026-10", base.counters, { prevKind: "explore" });
    const md = { team: "Mumbai Indians", league: "IPL", fixture: { teams: "MI v CSK", when: "Sun 7:30pm" }, source: "IPL schedule" };
    expect(all({ quest, matchDay: md }).title).toBe("MI v CSK, Sun 7:30pm");
    expect(all({ quest, matchDay: md }).why).toMatch(/10 pm/);
  });

  it("7. weekly: no verified fixture means no Match Day move, never an invented date", () => {
    const quest = newQuest("2026-10", base.counters, { prevKind: "explore" });
    const m = all({ quest, matchDay: { team: "Mumbai Indians", league: "IPL", source: "none" } });
    expect(m.title).toBe(quest.name);
  });

  it("7. weekly: this month's quest, then a plain plan once it is done", () => {
    const quest = newQuest("2026-10", base.counters, { prevKind: "explore" });
    expect(all({ quest }).kind).toBe("weekly");
    expect(all({ quest }).title).toBe("The Dice and Tea Round");
    expect(all({ quest: { ...quest, progress: quest.goal } }).kind).toBe("plan");
  });

  it("every move is exactly one real-world step with a link", () => {
    const states: Partial<HomeState>[] = [{ hasCard: false }, { fingerprintSeen: false }, { peopleMet: 0 }, { counters: [] }, { openTicket: ticket("Mon 4pm") }, {}];
    for (const s of states) {
      const m = all(s);
      expect(m.cta.href).toMatch(/^\//);
      expect(m.why.length).toBeGreaterThan(10);
      expect(m.plainWhy.length).toBeGreaterThan(5);
      expect(`${m.title} ${m.why}`).not.toMatch(/streak|don't lose|you missed|u\//i);
    }
  });
});

describe("back-off and rest weeks", () => {
  it("after 2 ignored moves of the same kind, Larry offers something smaller", () => {
    const m = all({ peopleMet: 0, ignoredMoves: ["second-person", "second-person"] });
    expect(m.backOff).toBe(true);
    expect(m.title).toBe("Was that step too big?");
    expect(m.cta.href).toContain("vibe=calm");
    expect(all({ peopleMet: 0, ignoredMoves: ["plan", "second-person"] }).backOff).toBeUndefined();
  });

  it("a rest week gets an easy option and never mentions the gap", () => {
    const resting = [counter("dice", 2, { lastIsoWeek: "2026-W42", spotWeeks: 2 })];
    expect(isRestWeek(resting, NOW)).toBe(true);
    expect(isRestWeek([counter("dice", 2)], NOW)).toBe(false);
    const quest = newQuest("2026-10", resting, { prevKind: "explore" });
    const m = all({ counters: resting, quest });
    expect(m.restWeek).toBe(true);
    expect(m.why).toMatch(/easy one/i);
    expect(m.why).not.toMatch(/weeks?|missed|been a while|gap/i);
  });

  it("is pure: same state and time, same move", () => {
    expect(all({ peopleMet: 0 })).toEqual(all({ peopleMet: 0 }));
    expect(weeklyMove(base, NOW)).toEqual(weeklyMove(base, NOW));
  });

  it("reads ticket days from the ticket's own words", () => {
    expect(ticketIsToday("Sat 11am", NOW)).toBe(true);
    expect(ticketIsToday("Today 4pm", NOW)).toBe(true);
    expect(ticketIsToday("Tomorrow 4pm", NOW)).toBe(false);
    expect(ticketIsToday("Sun 11am", NOW)).toBe(false);
    expect(ticketIsToday("", NOW)).toBe(false);
  });
});
