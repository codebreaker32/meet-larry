import { describe, expect, it } from "vitest";
import {
  canNudge,
  inQuietHours,
  localParts,
  nudgeAllowedFor,
  recordNudge,
  reminderAt,
  validWeekly,
  weeklyDue,
  weeklyLabel,
  whenToMs,
  WEEKLY_CHOICES,
} from "./nudges";

/** India time to ms: ist("2026-10-31T10:00") */
const ist = (s: string) => Date.parse(`${s}:00+05:30`);

describe("age gate", () => {
  it("nudges only a known adult", () => {
    expect(nudgeAllowedFor(undefined)).toBe(false);
    expect(nudgeAllowedFor(null)).toBe(false);
    expect(nudgeAllowedFor("13-17")).toBe(false);
    expect(nudgeAllowedFor("18-24")).toBe(true);
    expect(nudgeAllowedFor("adult")).toBe(true);
    expect(canNudge({ sentAt: [] }, { now: ist("2026-10-31T11:00"), age: undefined })).toEqual({ ok: false, reason: "age" });
    expect(canNudge({ sentAt: [] }, { now: ist("2026-10-31T11:00"), age: "13-17" })).toEqual({ ok: false, reason: "age" });
  });
});

describe("cap", () => {
  const age = "adult" as const;
  it("respects quiet hours 21:00-09:00 India time", () => {
    expect(inQuietHours(ist("2026-10-31T20:59"))).toBe(false);
    expect(inQuietHours(ist("2026-10-31T21:00"))).toBe(true);
    expect(inQuietHours(ist("2026-11-01T08:59"))).toBe(true);
    expect(inQuietHours(ist("2026-11-01T09:00"))).toBe(false);
    expect(canNudge({ sentAt: [] }, { now: ist("2026-10-31T22:00"), age })).toEqual({ ok: false, reason: "quiet" });
  });

  it("allows one a day", () => {
    const now = ist("2026-10-31T11:00");
    expect(canNudge({ sentAt: [] }, { now, age }).ok).toBe(true);
    const log = recordNudge({ sentAt: [] }, now, "weekly");
    expect(canNudge(log, { now: ist("2026-10-31T18:00"), age })).toEqual({ ok: false, reason: "daily" });
    expect(canNudge(log, { now: ist("2026-11-01T11:00"), age, target: "place:x" }).ok).toBe(true);
  });

  it("one a week about the same friend or place, and mutes hold", () => {
    const log = recordNudge({ sentAt: [] }, ist("2026-10-31T11:00"), "place:x");
    expect(canNudge(log, { now: ist("2026-11-03T11:00"), age, target: "place:x" })).toEqual({ ok: false, reason: "target" });
    expect(canNudge(log, { now: ist("2026-11-08T11:00"), age, target: "place:x" }).ok).toBe(true);
    expect(canNudge({ sentAt: [], muted: ["friend:a"] }, { now: ist("2026-11-08T11:00"), age, target: "friend:a" })).toEqual({ ok: false, reason: "muted" });
  });

  it("forgets old sends", () => {
    let log = recordNudge({ sentAt: [] }, ist("2026-10-01T11:00"), "a");
    log = recordNudge(log, ist("2026-10-31T11:00"));
    expect(log.sentAt).toHaveLength(1);
    expect(log.byTarget).toEqual({});
  });
});

describe("weekly slot", () => {
  it("offers only daytime slots", () => {
    for (const s of WEEKLY_CHOICES) expect(validWeekly(s)).toBe(true);
    expect(validWeekly({ day: 1, hour: 22 })).toBe(false);
    expect(validWeekly({ day: 7, hour: 10 })).toBe(false);
    expect(weeklyLabel({ day: 6, hour: 10 })).toBe("Sat 10am");
    expect(weeklyLabel({ day: 5, hour: 18 })).toBe("Fri 6pm");
  });

  it("is due once in the chosen hour", () => {
    const slot = { day: 6, hour: 10 };
    const sat = ist("2026-10-31T10:05"); // a Saturday
    expect(localParts(sat).day).toBe(6);
    expect(weeklyDue(slot, sat)).toBe(true);
    expect(weeklyDue(slot, sat, sat - 60_000)).toBe(false);
    expect(weeklyDue(slot, ist("2026-10-31T11:05"))).toBe(false);
    expect(weeklyDue(slot, ist("2026-11-07T10:01"), sat)).toBe(true);
  });
});

describe("plan reminders", () => {
  const now = ist("2026-10-31T01:00"); // Saturday, 1am

  it("reads the ticket's when label", () => {
    expect(whenToMs("Sat 11am", now)).toBe(ist("2026-10-31T11:00"));
    expect(whenToMs("Sun 3:30pm", now)).toBe(ist("2026-11-01T15:30"));
    expect(whenToMs("Tomorrow 10am", now)).toBe(ist("2026-11-01T10:00"));
    expect(whenToMs("Fri 6pm", now)).toBe(ist("2026-11-06T18:00"));
    expect(whenToMs("Sat 11am", ist("2026-10-31T12:00"))).toBe(ist("2026-11-07T11:00"));
    expect(whenToMs("Today 9am", ist("2026-10-31T12:00"))).toBeNull();
    expect(whenToMs("next game", now)).toBeNull();
  });

  it("reminds 2 hours before, never in quiet hours", () => {
    expect(reminderAt(ist("2026-10-31T15:00"), now)).toBe(ist("2026-10-31T13:00"));
    // 10am plan: 8am is quiet, 9am is still an hour before.
    expect(reminderAt(ist("2026-10-31T10:00"), now)).toBe(ist("2026-10-31T09:00"));
    // 9:15am plan: 9am is too close, so the evening before.
    expect(reminderAt(ist("2026-11-01T09:15"), now)).toBe(ist("2026-10-31T20:30"));
    // 10:30pm plan: 8:30pm is fine. 11pm plan: 9pm is quiet, so 8:30pm.
    expect(reminderAt(ist("2026-10-31T23:00"), now)).toBe(ist("2026-10-31T20:30"));
    for (const at of [reminderAt(ist("2026-11-01T09:15"), now), reminderAt(ist("2026-10-31T10:00"), now)]) {
      expect(inQuietHours(at!)).toBe(false);
    }
  });

  it("soon when already close, none when too close or too far", () => {
    const n = ist("2026-10-31T14:00");
    expect(reminderAt(ist("2026-10-31T15:00"), n)).toBe(n + 60_000);
    expect(reminderAt(ist("2026-10-31T14:20"), n)).toBeNull();
    expect(reminderAt(ist("2026-12-31T14:00"), n)).toBeNull();
  });
});
