import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkArrive,
  checkLeave,
  closedNow,
  fixAt,
  handleArrive,
  handleLeave,
  localClock,
  playback,
  playbackFallback,
  venueCentres,
  verifyVisitToken,
  type CheckinDeps,
} from "./checkin-verify";
import type { RepoKv } from "./db/types";
import { resetRateLimits } from "./rate-limit";
import type { Session } from "./types/account";
import type { WeekHours } from "./qloo";

const CAFE = { lat: 19.076, lon: 72.8777 }; // Mumbai
const PLACE_ID = "B7E5C0DE-1111-4222-8333-444455556666";
/** ~100 m north of the café. */
const near = { lat: CAFE.lat + 0.0009, lon: CAFE.lon, accuracyM: 20 };
/** ~1.1 km north. */
const far = { lat: CAFE.lat + 0.01, lon: CAFE.lon, accuracyM: 20 };
const MIN = 60_000;

function memKv(): RepoKv & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>();
  return {
    map,
    get: async <T,>(k: string) => (map.has(k) ? (structuredClone(map.get(k)) as T) : null),
    update: async <T,>(k: string, change: (cur: T | null) => T | null | undefined) => {
      const cur = (map.has(k) ? structuredClone(map.get(k)) : null) as T | null;
      const next = change(cur);
      if (next === null) return cur;
      if (next === undefined) {
        map.delete(k);
        return null;
      }
      map.set(k, next);
      return next;
    },
    del: async (k: string) => void map.delete(k),
  };
}

const allDay: WeekHours = Array.from({ length: 7 }, () => [{ open: 9 * 60, close: 21 * 60 }]);

function deps(over: Partial<CheckinDeps> & { session?: Session | null; hours?: unknown; clock?: { t: number } } = {}) {
  const clock = over.clock ?? { t: Date.UTC(2026, 9, 31, 6, 30) }; // 12:00 IST, a Saturday
  const glory = vi.fn(async (_uid: string, amount: number) => amount);
  const fetchPlace = vi.fn(async (id: string) => ({
    entity_id: id,
    name: "Café Condi",
    types: ["urn:entity:place"],
    location: CAFE,
    properties: over.hours ? { hours: over.hours } : {},
  }));
  const d: CheckinDeps = {
    getSession: async () => over.session ?? null,
    fetchPlace: fetchPlace as unknown as CheckinDeps["fetchPlace"],
    enrich: over.enrich ?? (async () => ({})),
    kv: over.kv ?? memKv(),
    addAccountGlory: glory,
    now: () => clock.t,
  };
  return { d, clock, glory, fetchPlace };
}

const req = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", "x-real-ip": "10.1.2.3" }, body: JSON.stringify(body) });

beforeEach(() => resetRateLimits());

describe("pure checks", () => {
  it("accepts a fix within 150 m (+ slack), refuses one further away, and a fuzzy one", () => {
    expect(fixAt([CAFE], near)).toBe("here");
    expect(fixAt([CAFE], far)).toBe("away");
    expect(fixAt([CAFE], { ...near, accuracyM: 400 })).toBe("fuzzy");
    expect(fixAt([CAFE], { lat: Number.NaN, lon: 1, accuracyM: 5 })).toBe("fuzzy");
  });

  it("D23: uses Amazon's pin too only when the two pins are under 150 m apart", () => {
    const amazonClose = { lat: CAFE.lat + 0.001, lon: CAFE.lon }; // ~111 m
    const amazonFar = { lat: CAFE.lat + 0.005, lon: CAFE.lon }; // ~556 m
    expect(venueCentres(CAFE, amazonClose)).toHaveLength(2);
    expect(venueCentres(CAFE, amazonFar)).toEqual([CAFE]);
    expect(venueCentres(CAFE, null)).toEqual([CAFE]);
    // 230 m north of Qloo's pin, 120 m from Amazon's: only the cross-check lets this person in.
    const fix = { lat: CAFE.lat + 0.00207, lon: CAFE.lon, accuracyM: 5 };
    expect(fixAt([CAFE], fix)).toBe("away");
    expect(fixAt(venueCentres(CAFE, amazonClose), fix)).toBe("here");
  });

  it("closed now by Qloo hours or Amazon's flag; unknown hours never block", () => {
    const noon = new Date(Date.UTC(2026, 9, 31, 6, 30)); // 12:00 IST
    const late = new Date(Date.UTC(2026, 9, 31, 17, 30)); // 23:00 IST
    expect(localClock(noon, CAFE)).toEqual({ day: 5, minute: 12 * 60 });
    expect(closedNow({ ...CAFE, hours: allDay }, null, noon)).toBe(false);
    expect(closedNow({ ...CAFE, hours: allDay }, null, late)).toBe(true);
    expect(closedNow({ ...CAFE }, null, late)).toBe(false);
    expect(closedNow({ ...CAFE }, { openNow: false }, noon)).toBe(true);
    expect(closedNow({ ...CAFE }, { openNow: null }, noon)).toBe(false);
    expect(closedNow({ ...CAFE, closedDown: true }, null, noon)).toBe(true);
    // A span past midnight still counts the next morning.
    const lateNight: WeekHours = Array.from({ length: 7 }, () => [{ open: 18 * 60, close: 26 * 60 }]);
    expect(closedNow({ ...CAFE, hours: lateNight }, null, new Date(Date.UTC(2026, 9, 31, 19, 30)))).toBe(false); // 01:00 IST
  });

  it("verify table: too far, fuzzy, too fast, too soon, and valid", () => {
    const t = 1_000_000;
    const claims = { t, d: 20 * MIN, la: near.lat, lo: near.lon };
    expect(checkLeave({ claims, fix: far, centres: [CAFE], now: t + 30 * MIN, demo: false })).toBe("too-far");
    expect(checkLeave({ claims, fix: { ...near, accuracyM: 900 }, centres: [CAFE], now: t + 30 * MIN, demo: false })).toBe("no-coords");
    expect(checkLeave({ claims: { ...claims, la: CAFE.lat - 0.0018 }, fix: near, centres: [CAFE], now: t + 20_000, demo: false })).toBe("too-fast");
    expect(checkLeave({ claims, fix: near, centres: [CAFE], now: t + 19 * MIN, demo: false })).toBe("too-soon");
    expect(checkLeave({ claims, fix: near, centres: [CAFE], now: t + 20 * MIN, demo: false })).toBeNull();
    // The demo account skips location and dwell.
    expect(checkLeave({ claims, fix: far, centres: [CAFE], now: t + 1, demo: true })).toBeNull();
    expect(checkArrive({ fix: far, centres: [CAFE], closed: true, demo: true })).toBeNull();
    expect(checkArrive({ fix: near, centres: [CAFE], closed: true, demo: false })).toBe("closed");
  });
});

describe("arrive and leave routes", () => {
  it("refuses an arrive from somewhere else, with the warm line, and records nothing", async () => {
    const { d } = deps();
    const kv = d.kv as ReturnType<typeof memKv>;
    const res = await handleArrive(req("/api/checkins/arrive", { placeId: PLACE_ID, ...far }), d);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ reason: "too-far", error: "Looks like you're not at Café Condi yet. Check in when you get there!" });
    expect([...kv.map.keys()].some((k) => k.startsWith("checkin-day:"))).toBe(false);
  });

  it("refuses an arrive while the place is closed", async () => {
    const hours = Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((day) => [day, [{ opens: "T09:00:00", closes: "T11:00:00" }]]));
    const { d } = deps({ hours });
    const res = await handleArrive(req("/api/checkins/arrive", { placeId: PLACE_ID, ...near }), d);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("Looks like Café Condi is closed right now. Check in when it's open!");
  });

  it("ignores a client 'demo' flag: only the server's session decides", async () => {
    const { d } = deps();
    const res = await handleArrive(req("/api/checkins/arrive", { placeId: PLACE_ID, ...far, demo: true }), d);
    expect(res.status).toBe(422);
  });

  it("counts a visit 20 minutes later, once per day, and never echoes the fix", async () => {
    const session: Session = { uid: "u1", isAdult: true, isDemo: false };
    const { d, clock, glory } = deps({ session });
    const a = await handleArrive(req("/api/checkins/arrive", { placeId: PLACE_ID, ...near }), d);
    expect(a.status).toBe(200);
    const arrived = await a.json();
    expect(arrived.dwellMs).toBe(20 * MIN);
    expect(JSON.stringify(arrived)).not.toContain(String(near.lat));
    expect(verifyVisitToken(arrived.visitToken, clock.t)).toEqual({ placeId: PLACE_ID, t: clock.t });
    expect(verifyVisitToken(arrived.visitToken.replace(/^./, "A") + "x", clock.t)).toBeNull();

    const early = await handleLeave(req("/api/checkins/leave", { visitToken: arrived.visitToken, ...near }), d);
    expect(await early.json()).toEqual({ verified: false, reason: "too-soon", gloryDelta: 0 });

    clock.t += 25 * MIN;
    const ok = await handleLeave(req("/api/checkins/leave", { visitToken: arrived.visitToken, ...near, saidHi: true }), d);
    expect(await ok.json()).toEqual({ verified: true, gloryDelta: 15 });
    expect(glory).toHaveBeenCalledWith("u1", 15);

    const again = await handleLeave(req("/api/checkins/leave", { visitToken: arrived.visitToken, ...near }), d);
    expect(await again.json()).toEqual({ verified: false, reason: "already-today", gloryDelta: 0 });
    const reArrive = await handleArrive(req("/api/checkins/arrive", { placeId: PLACE_ID, ...near }), d);
    expect(reArrive.status).toBe(409);
  });

  it("device-only people get verified too, with no Glory on the server", async () => {
    const { d, clock, glory } = deps();
    const arrived = await (await handleArrive(req("/api/checkins/arrive", { placeId: PLACE_ID, ...near }), d)).json();
    clock.t += 21 * MIN;
    const res = await (await handleLeave(req("/api/checkins/leave", { visitToken: arrived.visitToken, ...near }), d)).json();
    expect(res).toEqual({ verified: true, gloryDelta: 0 });
    expect(glory).not.toHaveBeenCalled();
  });

  it("device-only friends on one shared IP (cafe Wi-Fi, carrier NAT) don't block each other", async () => {
    const { d, clock } = deps();
    const a = await (await handleArrive(req("/api/checkins/arrive", { placeId: PLACE_ID, ...near, deviceId: "device-friend-a" }), d)).json();
    clock.t += 21 * MIN;
    expect(await (await handleLeave(req("/api/checkins/leave", { visitToken: a.visitToken, ...near }), d)).json()).toEqual({ verified: true, gloryDelta: 0 });
    // Friend B, same IP (req() always sends 10.1.2.3), arrives after A's visit counted, and still counts.
    const bArrive = await handleArrive(req("/api/checkins/arrive", { placeId: PLACE_ID, ...near, deviceId: "device-friend-b" }), d);
    expect(bArrive.status).toBe(200);
    const b = await bArrive.json();
    clock.t += 21 * MIN;
    expect(await (await handleLeave(req("/api/checkins/leave", { visitToken: b.visitToken, ...near }), d)).json()).toEqual({ verified: true, gloryDelta: 0 });
    // The same phone is still once per day.
    expect((await handleArrive(req("/api/checkins/arrive", { placeId: PLACE_ID, ...near, deviceId: "device-friend-a" }), d)).status).toBe(409);
  });

  it("a device-only visit keeps its day key when the phone's IP changes mid-visit", async () => {
    const { d, clock } = deps();
    const a = await (await handleArrive(req("/api/checkins/arrive", { placeId: PLACE_ID, ...near, deviceId: "device-roamer" }), d)).json();
    clock.t += 21 * MIN;
    const leave = new Request("http://localhost/api/checkins/leave", { method: "POST", headers: { "content-type": "application/json", "x-real-ip": "10.9.9.9" }, body: JSON.stringify({ visitToken: a.visitToken, ...near }) });
    expect(await (await handleLeave(leave, d)).json()).toEqual({ verified: true, gloryDelta: 0 });
    expect((await handleArrive(req("/api/checkins/arrive", { placeId: PLACE_ID, ...near, deviceId: "device-roamer" }), d)).status).toBe(409);
  });

  it("a leave from far away doesn't count", async () => {
    const { d, clock } = deps();
    const arrived = await (await handleArrive(req("/api/checkins/arrive", { placeId: PLACE_ID, ...near }), d)).json();
    clock.t += 40 * MIN;
    expect(await (await handleLeave(req("/api/checkins/leave", { visitToken: arrived.visitToken, ...far }), d)).json()).toEqual({
      verified: false,
      reason: "too-far",
      gloryDelta: 0,
    });
  });

  it("D19: the demo account skips location, closed-now and dwell, and its visit counts like a real one", async () => {
    const session: Session = { uid: "demo", isAdult: true, isDemo: true };
    const hours = { monday: [{ closed: true }], tuesday: [{ closed: true }], wednesday: [{ closed: true }], thursday: [{ closed: true }], friday: [{ closed: true }], saturday: [{ opens: "T01:00:00", closes: "T02:00:00" }], sunday: [{ closed: true }] };
    const { d, clock, glory } = deps({ session, hours });
    const a = await handleArrive(req("/api/checkins/arrive", { placeId: PLACE_ID, lat: 0, lon: 0, accuracyM: 5000 }), d);
    expect(a.status).toBe(200);
    const arrived = await a.json();
    expect(arrived.dwellMs).toBe(0);
    clock.t += 1000;
    const res = await (await handleLeave(req("/api/checkins/leave", { visitToken: arrived.visitToken, lat: 0, lon: 0, accuracyM: 5000 }), d)).json();
    expect(res).toEqual({ verified: true, gloryDelta: 10 });
    expect(glory).toHaveBeenCalledWith("demo", 10);
  });

  it("a token is tied to who arrived", async () => {
    const { d: signedIn, clock } = deps({ session: { uid: "u1", isAdult: true, isDemo: false } });
    const arrived = await (await handleArrive(req("/api/checkins/arrive", { placeId: PLACE_ID, ...near }), signedIn)).json();
    clock.t += 30 * MIN;
    const other = deps({ session: { uid: "u2", isAdult: true, isDemo: false }, kv: signedIn.kv, clock }).d;
    const res = await handleLeave(req("/api/checkins/leave", { visitToken: arrived.visitToken, ...near }), other);
    expect(res.status).toBe(410);
  });

  it("D23: Amazon's cross-checked pin lets in someone a slightly wrong Qloo pin would turn away", async () => {
    const amazonPin = { lat: CAFE.lat + 0.001, lon: CAFE.lon };
    const fix = { lat: CAFE.lat + 0.00207, lon: CAFE.lon, accuracyM: 5 };
    const withPin = deps({ enrich: async () => ({ pin: amazonPin }) }).d;
    expect((await handleArrive(req("/api/checkins/arrive", { placeId: PLACE_ID, ...fix }), withPin)).status).toBe(200);
    resetRateLimits();
    const without = deps().d;
    expect((await handleArrive(req("/api/checkins/arrive", { placeId: PLACE_ID, ...fix }), without)).status).toBe(422);
  });

  it("rejects malformed bodies without echoing them", async () => {
    const { d } = deps();
    const res = await handleArrive(req("/api/checkins/arrive", { placeId: "x", lat: 999 }), d);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toContain("999");
  });
});

describe("Larry's playback line", () => {
  it("follows the Guess vs Reality rules in the fixed lines", () => {
    expect(playbackFallback({ placeName: "Café Condi", visits: 1, guess: 4, reality: 2 }).line).not.toMatch(/\d|guess/i);
    expect(playbackFallback({ placeName: "Café Condi", visits: 1, guess: 2, reality: 4 }).line).toMatch(/undersold/);
    expect(playbackFallback({ placeName: "Café Condi", visits: 3, stage: "regular", stageEarned: true }).plain).toBe("You're a Regular at Café Condi now.");
  });

  it("uses the branch line when no model answers (the stub)", async () => {
    const out = await playback({ placeName: "Café Condi", visits: 1, stage: "rookie", stageEarned: true });
    expect(out.source).toBe("fallback");
    expect(out.line).toContain("Rookie");
  });
});
