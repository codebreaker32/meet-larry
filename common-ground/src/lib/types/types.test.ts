import { describe, expect, it } from "vitest";
import { ageOn } from "./account";
import { gloryFor, GLORY_RULES } from "./glory";
import { AGE_BUCKETS, isAdultBucket, QLOO_AGE_MAP } from "./signals";
import { NEVER_SYNCED, STORAGE_KEYS } from "./storage-keys";

describe("shared types", () => {
  it("works out age from a date of birth, and rejects impossible dates", () => {
    const now = new Date(Date.UTC(2026, 9, 30));
    expect(ageOn({ d: 30, m: 10, y: 2008 }, now)).toBe(18);
    expect(ageOn({ d: 31, m: 10, y: 2008 }, now)).toBe(17);
    expect(ageOn({ d: 31, m: 2, y: 2000 }, now)).toBeNull();
    expect(ageOn({ d: 1, m: 1, y: 2030 }, now)).toBeNull();
    expect(ageOn({ d: 1, m: 13, y: 2000 }, now)).toBeNull();
  });

  it("maps every age range to Qloo's own age buckets", () => {
    const qloo = new Set(["24_and_younger", "25_to_29", "30_to_34", "35_to_44", "45_to_54", "55_and_older"]);
    for (const b of AGE_BUCKETS) for (const v of QLOO_AGE_MAP[b].split(",")) expect(qloo.has(v), v).toBe(true);
    expect(isAdultBucket("13-17")).toBe(false);
    expect(isAdultBucket(undefined)).toBe(false);
    expect(isAdultBucket("18-24")).toBe(true);
  });

  it("never takes Glory away", () => {
    for (const v of Object.values(GLORY_RULES)) expect(v).toBeGreaterThan(0);
    expect(gloryFor(["visit", "said-hi"])).toBe(15);
    expect(gloryFor([])).toBe(0);
  });

  it("declares unique storage keys and keeps the device secret off sync", () => {
    const values = Object.values(STORAGE_KEYS);
    expect(new Set(values).size).toBe(values.length);
    expect(NEVER_SYNCED).toContain(STORAGE_KEYS.deviceSecret);
    expect(STORAGE_KEYS.persona).toBe("larry.persona");
  });
});
