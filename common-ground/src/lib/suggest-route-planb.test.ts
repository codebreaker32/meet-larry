import { beforeEach, describe, expect, it, vi } from "vitest";

// Regression: plan B "too loud" looks for a calmer place around the planned venue's own pin
// (within 500 m), not around where the person searched from, which can be km away.

const findPlaces = vi.fn();
const qlooPin = vi.fn();

vi.mock("@/lib/qloo", async (orig) => ({ ...(await orig<typeof import("@/lib/qloo")>()), findPlaces: (...a: unknown[]) => findPlaces(...a) }));
vi.mock("@/lib/suggest", async (orig) => ({ ...(await orig<typeof import("@/lib/suggest")>()), qlooPin: (...a: unknown[]) => qlooPin(...a) }));
vi.mock("@/lib/http", async (orig) => ({ ...(await orig<typeof import("@/lib/http")>()), optionalLease: async () => null }));

const { POST } = await import("@/app/api/suggest/route");
const { resetRateLimits } = await import("@/lib/rate-limit");

const VENUE = { lat: 19.06, lon: 72.83 };
const SEARCH = { lat: 19.08, lon: 72.85 }; // about 3 km away
const body = (place: Record<string, unknown>) => ({
  kind: "plan_b",
  obstacle: "loud",
  place: { id: "B7E5C0DE-1111-4222-8333-444455556666", name: "Loud Cafe", vibe: "lively", tags: [], ...place },
  item: { id: "ITEM-1", name: "Minecraft" },
  location: SEARCH,
});
const post = (b: unknown) => POST(new Request("http://localhost/api/suggest", { method: "POST", headers: { "content-type": "application/json", "x-real-ip": "10.4.4.4" }, body: JSON.stringify(b) }));

beforeEach(() => {
  resetRateLimits();
  findPlaces.mockReset().mockResolvedValue([{ id: "QUIET-1", name: "Quiet Books", vibe: "calm" }]);
  qlooPin.mockReset();
});

describe("plan B: too loud", () => {
  it("searches within 500 m of the venue's pin, not the person's search point", async () => {
    const res = await post(body({ at: VENUE }));
    expect(res.status).toBe(200);
    expect(findPlaces).toHaveBeenCalledTimes(1);
    const [, lat, lon, opts] = findPlaces.mock.calls[0];
    expect([lat, lon]).toEqual([VENUE.lat, VENUE.lon]);
    expect(opts).toMatchObject({ radius: 500, maxRadius: 500 });
    expect((await res.json()).nearer).toEqual({ id: "QUIET-1", name: "Quiet Books" });
  });

  it("looks the venue's pin up when the ticket didn't send it", async () => {
    qlooPin.mockResolvedValue(VENUE);
    await post(body({}));
    expect(findPlaces.mock.calls[0].slice(1, 3)).toEqual([VENUE.lat, VENUE.lon]);
  });

  it("offers no 'short walk' place when the venue has no pin", async () => {
    qlooPin.mockResolvedValue(null);
    const out = await (await post(body({}))).json();
    expect(findPlaces).not.toHaveBeenCalled();
    expect(out.nearer).toBeUndefined();
  });
});
