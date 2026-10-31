import { describe, expect, it } from "vitest";
import {
  applyLeave,
  arriveRefusalLine,
  countedLine,
  foldUnverified,
  foldVerified,
  foldWeek,
  emptyCounter,
  isStale,
  leaveOutcome,
  leaveReasonLine,
  loadCounters,
  loadOpenVisit,
  MISSED_LEAVE_MS,
  nextStageLine,
  parseCounters,
  parseOpenVisit,
  restingThisWeek,
  saveOpenVisit,
  settleStaleVisit,
  spotLine,
  toSynced,
  type PlaceCounter,
} from "./checkins";
import { isoWeek, weeksBetween } from "./iso-week";
import {
  buildTicket,
  currentRung,
  daytimeSlots,
  isDaytime,
  ladderPlaces,
  nextOnLadder,
  planBFor,
  rungAfter,
  stepFromTicket,
  vibeOf,
  whenChoices,
  type PlanStep,
} from "./suggest-steps";

const cafe = { id: "p1", name: "Café Condi" };

/** A tiny localStorage for the device functions. */
function withStorage() {
  const map = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
  };
  return map;
}

describe("ISO weeks", () => {
  it("names weeks the ISO way, across year ends", () => {
    expect(isoWeek(new Date(2026, 9, 31))).toBe("2026-W44");
    expect(isoWeek(new Date(2026, 0, 1))).toBe("2026-W01");
    expect(isoWeek(new Date(2027, 0, 1))).toBe("2026-W53");
    expect(weeksBetween("2026-W52", "2027-W02")).toBe(3);
    expect(weeksBetween("2026-W44", "2026-W44")).toBe(0);
  });
});

describe("check-in v2 counters (device only)", () => {
  it("folds verified visits into stages at 1, 3, 6, 10 and 20", () => {
    let list: PlaceCounter[] = [];
    const earned: (string | null)[] = [];
    for (let i = 0; i < 20; i++) {
      const out = foldVerified(list, cafe, "2026-W44");
      list = out.counters;
      earned.push(out.stageEarned);
    }
    expect(earned.filter(Boolean)).toEqual(["rookie", "regular", "veteran", "elite", "legend"]);
    expect(earned.indexOf("regular")).toBe(2);
    expect(list[0]).toMatchObject({ visits: 20, stage: "legend", spotWeeks: 1 });
  });

  it("keeps no times: a counter holds counts and weeks only, and sync drops the weeks", () => {
    const out = foldVerified([], cafe, "2026-W44");
    expect(Object.keys(out.counter).sort()).toEqual(["lastIsoWeek", "placeId", "placeName", "spotWeeks", "stage", "totalWeeks", "visits", "weeksBits"]);
    expect(toSynced(out.counters)).toEqual([{ placeId: "p1", placeName: "Café Condi", visits: 1, stage: "rookie", spotWeeks: 1 }]);
  });

  it("a rest week pauses the Spot count and never resets it", () => {
    let c = foldWeek(emptyCounter("p1", "Café Condi", "2026-W40"), "2026-W40");
    c = foldWeek(c, "2026-W41");
    c = foldWeek(c, "2026-W44"); // two rest weeks
    expect(c).toMatchObject({ weeksBits: "11001", spotWeeks: 3, lastIsoWeek: "2026-W44" });
    expect(foldWeek(c, "2026-W44")).toBe(c); // same week again changes nothing
    expect(foldWeek(c, "2026-W30")).toBe(c); // a clock that went back changes nothing
    expect(restingThisWeek(c, "2026-W45")).toBe(true);
    expect(restingThisWeek(c, "2026-W44")).toBe(false);
    expect(spotLine(c)).toBe("3 weeks at Café Condi.");
    expect(spotLine({ spotWeeks: 1, placeName: "X" })).toBeNull();
  });

  it("an unverified visit shows as Visited and adds no stage or Spot week (D16)", () => {
    const out = foldUnverified([], cafe, "2026-W44");
    expect(out.counter).toMatchObject({ visits: 0, stage: null, spotWeeks: 0, unverified: 1 });
    expect(out.stageEarned).toBeNull();
  });

  it("says the next stage only when it's close", () => {
    expect(nextStageLine(4)).toBe("Veteran is 2 visits away.");
    expect(nextStageLine(5)).toBe("Veteran is 1 visit away.");
    expect(nextStageLine(10)).toBeNull(); // Legend is 10 away
    expect(nextStageLine(0)).toBeNull();
    expect(countedLine({ visits: 3, placeName: "Café Condi" })).toBe("Counted. That's visit 3 at Café Condi.");
  });

  it("ignores broken storage", () => {
    expect(parseCounters("not json")).toEqual([]);
    const out = parseCounters(JSON.stringify([{ placeId: "x" }, { placeId: "a", placeName: "A", visits: 3, weeksBits: "1x", lastIsoWeek: "nope", stage: "boss", spotWeeks: -2 }]));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ placeId: "a", visits: 3, weeksBits: "", stage: "regular", spotWeeks: 0 });
    expect(parseOpenVisit("{}")).toBeNull();
  });

  it("maps each Leave answer to what the phone keeps", () => {
    expect(leaveOutcome(true)).toBe("counted");
    expect(leaveOutcome(false, "too-soon")).toBe("visited");
    expect(leaveOutcome(false, "too-far")).toBe("visited");
    expect(leaveOutcome(false, "too-fast")).toBe("nothing");
    expect(leaveOutcome(false, "already-today")).toBe("nothing");
    expect(leaveOutcome(false, "no-coords")).toBe("keep-open");
  });

  it("deletes the open visit (token and arrive time) after Leave, and folds the count", () => {
    withStorage();
    const v = { placeId: "p1", placeName: "Café Condi", visitToken: "tok.tok.tok", dwellMs: 1_200_000, arrivedAt: 1_000 };
    saveOpenVisit(v);
    expect(loadOpenVisit()).toMatchObject({ placeId: "p1" });
    expect(applyLeave(v, false, "no-coords", 2_000)).toBeNull();
    expect(loadOpenVisit()).not.toBeNull(); // kept for another try
    const fold = applyLeave(v, true, undefined, Date.UTC(2026, 9, 31, 12));
    expect(fold?.counter).toMatchObject({ visits: 1, stage: "rookie" });
    expect(loadOpenVisit()).toBeNull();
    expect(loadCounters()[0]).toMatchObject({ placeId: "p1", visits: 1 });
  });

  it("settles a visit with no Leave for 12 hours as Visited", () => {
    withStorage();
    const now = Date.UTC(2026, 9, 31, 12);
    saveOpenVisit({ placeId: "p2", placeName: "Library", visitToken: "a.b.c", dwellMs: 1_200_000, arrivedAt: now - MISSED_LEAVE_MS - 1 });
    expect(isStale(loadOpenVisit()!, now)).toBe(true);
    expect(settleStaleVisit(now)).toBe(true);
    expect(loadOpenVisit()).toBeNull();
    expect(loadCounters()[0]).toMatchObject({ placeId: "p2", visits: 0, unverified: 1 });
  });

  it("words refusals warmly, with the user's copy", () => {
    expect(arriveRefusalLine("too-far", "Café Condi")).toBe("Looks like you're not at Café Condi yet. Check in when you get there!");
    expect(arriveRefusalLine("closed", "Café Condi")).toBe("Looks like Café Condi is closed right now. Check in when it's open!");
    for (const r of ["too-soon", "too-far", "too-fast", "already-today", "no-coords"] as const) {
      expect(leaveReasonLine(r, "Café Condi")).not.toMatch(/warning|danger|violation|ban|fraud|invalid/i);
    }
  });
});

describe("the Quiet-to-Lively Ladder", () => {
  it("moves up on Easy, stays on OK and steps back on Hard, within the rungs", () => {
    expect(rungAfter(0, "good")).toBe(1);
    expect(rungAfter(1, "okay")).toBe(1);
    expect(rungAfter(1, "hard")).toBe(1); // Hard keeps the rung; the visit gets shorter
    expect(rungAfter(0, "hard")).toBe(0);
    expect(rungAfter(2, "good")).toBe(2);
  });

  it("grades vibe from the server first, then the place's own tags", () => {
    expect(vibeOf({ tags: ["Cafe"], vibe: "lively" })).toBe("lively");
    expect(vibeOf({ tags: ["Library"] })).toBe("calm");
    expect(vibeOf({ tags: ["Video arcade"] })).toBe("lively");
    expect(vibeOf({ tags: ["Board game cafe"] })).toBe("cosy");
  });

  const step = (over: Partial<PlanStep>): PlanStep => ({
    id: "s",
    kind: "go",
    text: "Go",
    createdAt: 1,
    done: true,
    doneAt: 2,
    placeId: "lib",
    placeName: "Library",
    vibe: "calm",
    rung: 0,
    ...over,
  });

  it("suggests a real place on the next rung, and the same place when staying", () => {
    const pool = ladderPlaces([], [
      { id: "lib", name: "Library", tags: ["Library"], affinity: 1 },
      { id: "cafe", name: "Café Condi", tags: ["Board game cafe"], affinity: 1 },
    ]);
    expect(nextOnLadder(step({}), "good", pool)).toMatchObject({ move: "up", vibe: "cosy", place: { id: "cafe" } });
    expect(nextOnLadder(step({}), "okay", pool)).toMatchObject({ move: "stay", vibe: "calm", place: { id: "lib" } });
    const noLively = nextOnLadder(step({ placeId: "cafe", placeName: "Café Condi", vibe: "cosy", rung: 1 }), "good", pool);
    expect(noLively).toMatchObject({ move: "up", vibe: "lively" });
    expect(noLively.place).toBeUndefined();
  });

  it("knows where someone stands from their last finished place step", () => {
    expect(currentRung([])).toBe(0);
    expect(currentRung([step({ feeling: "good" })])).toBe(1);
    expect(currentRung([step({ vibe: "cosy", rung: 1, feeling: "hard" })])).toBe(1);
  });
});

describe("Plan Ticket helpers", () => {
  // Thursday 29 Oct 2026, 10:00 local time.
  const now = new Date(2026, 9, 29, 10, 0);

  it("offers daytime slots only, and skips days the hours say are closed", () => {
    expect(daytimeSlots(now)).toEqual(["Fri 4pm", "Sat 11am", "Sun 2pm"]);
    expect(daytimeSlots(now, "Mon-Sat 9am-6pm; Sunday: Closed")).toEqual(["Fri 4pm", "Sat 11am"]);
    expect(isDaytime("Sat 11am")).toBe(true);
    expect(isDaytime("Fri 9pm")).toBe(false);
    expect(isDaytime("Friday evening")).toBe(false);
  });

  it("builds a ticket from a chosen place and bridge, and saves it as a go step", () => {
    const ticket = buildTicket({
      place: { id: "cafe", name: "Café Condi", tags: ["Board game cafe"], affinity: 1 },
      bridge: { id: "z", name: "Zelda", domain: "videogame" },
      now,
    });
    expect(ticket).toMatchObject({ when: "Fri 4pm", opener: "Have you tried Zelda?", rung: 1, item: { name: "Zelda" } });
    expect(ticket.place.fits).toEqual([]);
    const draft = stepFromTicket(ticket, { when: "Sat 11am", planB: planBFor("words", ticket), withPerson: "Sam" });
    expect(draft).toMatchObject({
      kind: "go",
      text: "Go to Café Condi, Sat 11am. Bring up Zelda.",
      placeId: "cafe",
      when: "Sat 11am",
      planB: "If I don't know what to say, I'll bring up Zelda.",
      withPerson: "Sam",
      vibe: "cosy",
    });
  });

  it("drops a night-time slot from Larry's ticket", () => {
    const ticket = buildTicket({ place: { id: "c", name: "C", tags: [], affinity: 1 }, now });
    expect(whenChoices({ ...ticket, when: "Sat 10pm" }, now)).not.toContain("Sat 10pm");
    expect(whenChoices({ ...ticket, when: "Sat 11am" }, now)[0]).toBe("Sat 11am");
  });
});
