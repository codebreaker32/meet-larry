import { describe, expect, it } from "vitest";
import {
  accountSettingsSchema,
  arriveSchema,
  chatSignalsSchema,
  friendsPostSchema,
  leaveSchema,
  matchdayQuerySchema,
  podiumMineSchema,
  podiumRerollSchema,
  signupSchema,
  syncBlobSchema,
} from "./schemas";

const KEY = "a".repeat(64);
const KEY2 = "b".repeat(64);

describe("final-build request schemas", () => {
  it("accepts a check-in arrive and leave, and rejects a bad podium key", () => {
    expect(arriveSchema.safeParse({ placeId: "p-1", lat: 19.1, lon: 72.8, accuracyM: 20 }).success).toBe(true);
    expect(arriveSchema.safeParse({ placeId: "p-1", lat: 99, lon: 72.8, accuracyM: 20 }).success).toBe(false);
    const leave = { visitToken: "abc.def.ghi-jkl_mno", lat: 19.1, lon: 72.8, accuracyM: 20 };
    expect(leaveSchema.safeParse({ ...leave, podiumKey: KEY, saidHi: true }).success).toBe(true);
    expect(leaveSchema.safeParse({ ...leave, podiumKey: "QuietOtter42" }).success).toBe(false);
  });

  it("drops any client demo flag: only the server decides the demo account (D19)", () => {
    const out = arriveSchema.parse({ placeId: "p-1", lat: 19.1, lon: 72.8, accuracyM: 20, demo: true, isDemo: true, isGuest: true });
    expect(out).toEqual({ placeId: "p-1", lat: 19.1, lon: 72.8, accuracyM: 20 });
  });

  it("takes the leaderboard switch as a strict boolean (D12)", () => {
    expect(accountSettingsSchema.parse({ showOnLeaderboards: true })).toEqual({ showOnLeaderboards: true });
    expect(accountSettingsSchema.safeParse({ showOnLeaderboards: "yes" }).success).toBe(false);
    expect(accountSettingsSchema.safeParse({}).success).toBe(false);
    expect(accountSettingsSchema.safeParse({ showOnLeaderboards: true, isDemo: true }).success).toBe(false);
  });

  it("only takes usernames the generator makes, so no real names", () => {
    const dob = { d: 1, m: 2, y: 2000 };
    expect(signupSchema.safeParse({ name: "Sam", username: "QuietOtter42", dob }).success).toBe(true);
    expect(signupSchema.safeParse({ name: "Sam", username: "PriyaSharma22", dob }).success).toBe(false);
    expect(signupSchema.safeParse({ name: "Sam", username: "QuietOtter1", dob }).success).toBe(false);
    expect(signupSchema.safeParse({ name: "   ", username: "QuietOtter42", dob }).success).toBe(false);
  });

  it("syncs folded counts only: no weeks bitset, no visit times", () => {
    const out = syncBlobSchema.parse({
      persona: null,
      steps: [{ id: "s1", kind: "go", text: "Go to Café Condi", createdAt: 1, done: true, doneAt: 2, checkedAt: 3, placeId: "p-1" }],
      placeCounters: [{ placeId: "p-1", placeName: "Café Condi", visits: 3, stage: "regular", spotWeeks: 2, weeksBits: "1011", lastIsoWeek: "2026-W44" }],
      publicTitleCounts: { "final-boss": 1 },
    });
    expect(out.steps[0]).not.toHaveProperty("doneAt");
    expect(out.steps[0]).not.toHaveProperty("checkedAt");
    expect(out.steps[0]).toHaveProperty("placeId", "p-1");
    expect(out.placeCounters[0]).toEqual({ placeId: "p-1", placeName: "Café Condi", visits: 3, stage: "regular", spotWeeks: 2 });
  });

  it("validates podium and friend bodies", () => {
    expect(podiumRerollSchema.safeParse({ oldKey: KEY, newKey: KEY2 }).success).toBe(true);
    expect(podiumRerollSchema.safeParse({ oldKey: KEY, newKey: KEY }).success).toBe(false);
    expect(podiumMineSchema.safeParse({ keys: [{ placeId: "p-1", key: KEY }] }).success).toBe(true);
    expect(friendsPostSchema.safeParse({ action: "invite" }).success).toBe(true);
    expect(friendsPostSchema.safeParse({ action: "accept", code: "x".repeat(22) }).success).toBe(true);
    expect(friendsPostSchema.safeParse({ action: "accept", code: "short" }).success).toBe(false);
  });

  it("parses Match Day entity lists", () => {
    expect(matchdayQuerySchema.parse({ entities: "a-1, b-2,a-1" }).entities).toEqual(["a-1", "b-2"]);
    expect(matchdayQuerySchema.safeParse({ entities: "" }).success).toBe(false);
  });

  it("lets existing AI bodies carry signals", () => {
    const body = { a: { name: "Sam", items: [] }, b: { name: "Priya", items: [] }, history: [], signals: { mood: "chill", ageBucket: "18-24", hiddenGems: true } };
    expect(chatSignalsSchema.parse(body).signals).toEqual({ mood: "chill", ageBucket: "18-24", hiddenGems: true });
    expect(chatSignalsSchema.safeParse({ ...body, signals: { mood: "angry" } }).success).toBe(false);
  });
});
