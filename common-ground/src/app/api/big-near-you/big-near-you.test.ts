import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { areaCell, bigNearYou, qlooAge, resetBigNearYouCache } from "./big";
import { GET } from "./route";
import { resetRateLimits } from "@/lib/rate-limit";

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: async () => {} }));

const entities = [
  { entity_id: "A1", name: "Gully Boy", properties: { image: { url: "https://images.qloo.com/i/a.jpg" } } },
  { entity_id: "B2", name: "Sanju" },
  { entity_id: "B2", name: "Sanju" },
  { name: "No id" },
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetBigNearYouCache();
  resetRateLimits();
  vi.stubEnv("QLOO_KEY", "test-key");
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ results: { entities } }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Big near you (Qloo insights + signal.location, movies only)", () => {
  it("asks Qloo for well-known films around a city-scale cell, never the precise point", async () => {
    const items = await bigNearYou(19.0596, 72.8347, "25-34");
    expect(items).toEqual([
      { id: "A1", name: "Gully Boy", domain: "movie", image: "https://images.qloo.com/i/a.jpg" },
      { id: "B2", name: "Sanju", domain: "movie", image: undefined },
    ]);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe("/v2/insights");
    expect(url.searchParams.get("filter.type")).toBe("urn:entity:movie");
    expect(url.searchParams.get("signal.location")).toBe("POINT(72.8 19.1)");
    expect(url.searchParams.get("filter.popularity.min")).toBe("0.9");
    // One age value only (a comma list can make Qloo drop the signal).
    expect(url.searchParams.get("signal.demographics.age")).toBe("25_to_29");
    expect(url.toString()).not.toContain("19.0596");
    expect(url.toString()).not.toContain("trends");
  });

  it("caches per area cell and age band", async () => {
    await bigNearYou(19.06, 72.83);
    await bigNearYou(19.07, 72.84);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await bigNearYou(19.07, 72.84, "18-24");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns nothing, never made-up films, when Qloo fails", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    expect(await bigNearYou(28.6, 77.2)).toEqual([]);
    fetchMock.mockRejectedValueOnce(new Error("down"));
    expect(await bigNearYou(12.9, 77.6)).toEqual([]);
  });

  it("helpers round to a city cell and send a single age value", () => {
    expect(areaCell(19.0596)).toBe(19.1);
    expect(qlooAge("45+")).toBe("45_to_54");
    expect(qlooAge(undefined)).toBeUndefined();
  });

  it("the route checks its input and answers with items", async () => {
    const ok = await GET(new NextRequest("http://x/api/big-near-you?lat=19.06&lon=72.83"));
    expect(ok.status).toBe(200);
    expect((await ok.json()).items).toHaveLength(2);
    const bad = await GET(new NextRequest("http://x/api/big-near-you?lat=abc"));
    expect(bad.status).toBe(400);
    const missing = await GET(new NextRequest("http://x/api/big-near-you"));
    expect(missing.status).toBe(400);
  });
});
