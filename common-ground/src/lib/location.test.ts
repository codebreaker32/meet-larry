// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  coarsen,
  declineLocation,
  getPreciseFix,
  hasAnsweredLocationAsk,
  LOCATION_CHOICE_KEY,
  LOCATION_KEY,
  readLocationChoice,
  readStoredLocation,
  refreshLocationSilently,
  locationForRequest,
  requestLocation,
  setLocationEnabled,
} from "./location";

type Success = (p: GeolocationPosition) => void;
type Failure = (e: GeolocationPositionError) => void;

function mockGeo(result: { lat: number; lon: number; accuracy?: number } | "deny", permission: PermissionState | null = "granted") {
  const getCurrentPosition = vi.fn((ok: Success, fail: Failure) => {
    if (result === "deny") fail({ code: 1, message: "denied" } as GeolocationPositionError);
    else ok({ coords: { latitude: result.lat, longitude: result.lon, accuracy: result.accuracy ?? 20 } } as GeolocationPosition);
  });
  Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition }, configurable: true });
  Object.defineProperty(navigator, "permissions", {
    value: permission ? { query: vi.fn(async () => ({ state: permission })) } : undefined,
    configurable: true,
  });
  return getCurrentPosition;
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("location (D24: ask once, coarse point on the device)", () => {
  it("rounds to 2 decimals", () => {
    expect(coarsen(19.07612)).toBe(19.08);
    expect(coarsen(72.87765)).toBe(72.88);
    expect(coarsen(-0.004)).toBe(-0);
  });

  it("Share location stores only a coarse point with its time and remembers yes", async () => {
    mockGeo({ lat: 19.076123, lon: 72.877655 });
    const point = await requestLocation();
    expect(point).toMatchObject({ lat: 19.08, lon: 72.88 });
    const raw = JSON.parse(localStorage.getItem(LOCATION_KEY)!);
    expect(raw).toEqual({ lat: 19.08, lon: 72.88, at: expect.any(Number) });
    expect(readLocationChoice()).toBe("on");
    expect(hasAnsweredLocationAsk()).toBe(true);
  });

  it("a browser no is remembered as off, so nothing asks again", async () => {
    mockGeo("deny");
    expect(await requestLocation()).toBeNull();
    expect(readStoredLocation()).toBeNull();
    expect(readLocationChoice()).toBe("off");
  });

  it("Not now and the Settings switch off forget the point", async () => {
    mockGeo({ lat: 1, lon: 2 });
    await setLocationEnabled(true);
    expect(readStoredLocation()).not.toBeNull();
    await setLocationEnabled(false);
    expect(readStoredLocation()).toBeNull();
    expect(readLocationChoice()).toBe("off");
    declineLocation();
    expect(hasAnsweredLocationAsk()).toBe(true);
  });

  it("refreshes silently only when the person said yes and permission is already granted", async () => {
    const geo = mockGeo({ lat: 10.123, lon: 20.456 }, "prompt");
    // Never asked: no refresh at all.
    expect(await refreshLocationSilently(true)).toBeNull();
    expect(geo).not.toHaveBeenCalled();

    localStorage.setItem(LOCATION_CHOICE_KEY, "on");
    // Permission not granted: still no call, so no prompt can appear.
    await refreshLocationSilently(true);
    expect(geo).not.toHaveBeenCalled();

    mockGeo({ lat: 10.123, lon: 20.456 }, "granted");
    const p = await refreshLocationSilently(true);
    expect(p).toMatchObject({ lat: 10.12, lon: 20.46 });
  });

  it("skips a fresh point unless forced, and never refreshes after off", async () => {
    const geo = mockGeo({ lat: 5, lon: 5 }, "granted");
    await requestLocation();
    geo.mockClear();
    await refreshLocationSilently();
    expect(geo).not.toHaveBeenCalled();
    declineLocation();
    await refreshLocationSilently(true);
    expect(geo).not.toHaveBeenCalled();
  });

  it("ignores a broken stored value", () => {
    localStorage.setItem(LOCATION_KEY, "{not json");
    expect(readStoredLocation()).toBeNull();
    localStorage.setItem(LOCATION_KEY, JSON.stringify({ lat: 200, lon: 0, at: 1 }));
    expect(readStoredLocation()).toBeNull();
  });

  it("the precise fix for check-ins is returned, never stored", async () => {
    mockGeo({ lat: 19.0761234, lon: 72.8776559, accuracy: 12 });
    expect(await getPreciseFix()).toEqual({ lat: 19.0761234, lon: 72.8776559, accuracy: 12 });
    expect(localStorage.getItem(LOCATION_KEY)).toBeNull();
  });
  it("a request for places sends the stored point, or reads silently when the browser already allows it", async () => {
    localStorage.setItem(LOCATION_KEY, JSON.stringify({ lat: 19.07, lon: 72.87, at: Date.now() }));
    expect(await locationForRequest()).toEqual({ lat: 19.07, lon: 72.87 });
    localStorage.removeItem(LOCATION_KEY);
    // Never asked in the app, but granted in the browser: read with no prompt, and remembered.
    mockGeo({ lat: 10.123, lon: 20.456 }, "granted");
    expect(await locationForRequest()).toEqual({ lat: 10.12, lon: 20.46 });
    expect(readLocationChoice()).toBe("on");
    // Off in the app wins over the browser.
    declineLocation();
    const geo = mockGeo({ lat: 1, lon: 1 }, "granted");
    expect(await locationForRequest()).toBeNull();
    expect(geo).not.toHaveBeenCalled();
  });
});
