import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearLocationCache, enrichPlace, metresBetween, orderStops, parseAmazonHours, sameName, walkMinutes } from "./location";

// Amazon Location is mocked at fetch: no real calls, and the key never appears in an error.
const KEY = "test-location-key";
const CONDI = { name: "Café Condi", lat: 19.0596, lon: 72.8295 };

type Call = { url: string; body: Record<string, unknown> };
let calls: Call[] = [];
let reply: (url: string, body: Record<string, unknown>) => unknown = () => ({});

beforeEach(() => {
  process.env.AWS_LOCATION_API_KEY = KEY;
  process.env.AWS_LOCATION_REGION = "ap-south-1";
  clearLocationCache();
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      calls.push({ url, body });
      const r = reply(url, body);
      if (r instanceof Response) return r;
      return new Response(JSON.stringify(r), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AWS_LOCATION_API_KEY;
});

const item = (title: string, lat: number, lon: number, display?: string[], openNow?: boolean) => ({
  Title: title,
  Position: [lon, lat],
  ...(display ? { OpeningHours: [{ Display: display, OpenNow: openNow }] } : {}),
});

describe("sameName", () => {
  it("ignores case and punctuation, and accepts containment or 60% word overlap", () => {
    expect(sameName("Café Condi", "CAFE CONDI")).toBe(true);
    expect(sameName("Kitab Khana", "Kitab Khana Bookstore")).toBe(true);
    expect(sameName("Dice & Tea Board Game Café", "Dice and Tea Board Game Cafe, Bandra")).toBe(true);
    expect(sameName("Prithvi Café", "Prithvi Theatre")).toBe(false);
    expect(sameName("Starbucks", "Blue Tokai")).toBe(false);
  });

  it("doesn't match different venues that share only generic words or a raw substring", () => {
    expect(sameName("The Irish House", "The Beer House")).toBe(false);
    expect(sameName("The Pub", "The Public House")).toBe(false);
    expect(sameName("Blue Bar", "Blue Frog Bar and Kitchen Lounge")).toBe(false);
    expect(sameName("Starbucks", "Starbucks Coffee")).toBe(true);
    expect(sameName("The Irish House", "The Irish House, Lower Parel")).toBe(true);
  });
});

describe("parseAmazonHours", () => {
  it("reads day ranges, lists, split times, closed days and past-midnight closes", () => {
    const week = parseAmazonHours(["Mon-Fri: 09:00 - 13:00, 14:00 - 18:00", "Sat: 10:00 - 02:00", "Sun: Closed"])!;
    expect(week[0]).toEqual([
      { open: 540, close: 780 },
      { open: 840, close: 1080 },
    ]);
    expect(week[5]).toEqual([{ open: 600, close: 1560 }]);
    expect(week[6]).toEqual([]);
    expect(parseAmazonHours(["Mon-Sun: 10:30 - 19:30"])!.every((d) => d.length === 1)).toBe(true);
    expect(parseAmazonHours(["Daily: 08:00 - 20:00"])![3]).toEqual([{ open: 480, close: 1200 }]);
    expect(parseAmazonHours(["nonsense"])).toBeUndefined();
    expect(parseAmazonHours(null)).toBeUndefined();
  });
});

describe("enrichPlace", () => {
  it("borrows hours, open-now and the pin when the name matches within 150 m", async () => {
    reply = () => ({ ResultItems: [item("Cafe Condi", CONDI.lat + 0.0005, CONDI.lon, ["Mon-Sun: 10:30 - 19:30"], false)] });
    const out = await enrichPlace(CONDI, new Date("2026-10-30T10:00:00+05:30"));
    expect(out.hours).toBe("Daily 10:30am-7:30pm");
    expect(out.slots?.length).toBeGreaterThan(0);
    expect(out.openNow).toBe(false);
    expect(out.pin).toEqual({ lat: CONDI.lat + 0.0005, lon: CONDI.lon });
    expect(calls[0].url).toBe(`https://places.geo.ap-south-1.amazonaws.com/v2/search-text?key=${KEY}`);
    expect(calls[0].body).toMatchObject({ QueryText: "Café Condi", BiasPosition: [CONDI.lon, CONDI.lat], AdditionalFeatures: ["Contact"] });
  });

  it("borrows nothing when the same name is more than 150 m away, or a near place has another name", async () => {
    reply = () => ({
      ResultItems: [item("Café Condi", CONDI.lat + 0.01, CONDI.lon, ["Mon-Sun: 09:00 - 21:00"]), item("Blue Tokai", CONDI.lat, CONDI.lon, ["Mon-Sun: 09:00 - 21:00"])],
    });
    expect(await enrichPlace(CONDI)).toEqual({});
  });

  it("keeps Qloo's hours when Qloo has them (pin and open-now only)", async () => {
    reply = () => ({ ResultItems: [item("Café Condi", CONDI.lat, CONDI.lon, ["Mon-Sun: 09:00 - 21:00"], true)] });
    const out = await enrichPlace({ ...CONDI, hours: "Daily 8am-10pm" });
    expect(out.hours).toBeUndefined();
    expect(out.openNow).toBe(true);
  });

  it("returns {} on any failure, without a key or a pin, and caches answers for a day", async () => {
    reply = () => new Response("nope", { status: 500 });
    expect(await enrichPlace(CONDI)).toEqual({});
    expect(await enrichPlace({ name: "Café Condi" })).toEqual({});
    delete process.env.AWS_LOCATION_API_KEY;
    expect(await enrichPlace(CONDI)).toEqual({});
    process.env.AWS_LOCATION_API_KEY = KEY;
    reply = () => ({ ResultItems: [item("Café Condi", CONDI.lat, CONDI.lon, ["Mon-Sun: 09:00 - 21:00"])] });
    const n = calls.length;
    await enrichPlace({ ...CONDI, name: "Cafe Condi!" });
    await enrichPlace({ ...CONDI, name: "Cafe Condi!" });
    expect(calls.length).toBe(n + 1);
  });
});

describe("walkMinutes and orderStops", () => {
  it("reads the pedestrian duration in seconds and rounds up to minutes", async () => {
    reply = () => ({ Routes: [{ Legs: [{ PedestrianLegDetails: { Summary: { Overview: { Duration: 661 } } } }] }] });
    expect(await walkMinutes({ lat: 19.06, lon: 72.83 }, CONDI)).toBe(12);
    expect(calls[0].url).toContain("https://routes.geo.ap-south-1.amazonaws.com/v2/routes?key=");
    expect(calls[0].body).toMatchObject({ Origin: [72.83, 19.06], Destination: [CONDI.lon, CONDI.lat], TravelMode: "Pedestrian", LegAdditionalFeatures: ["Summary"] });
  });

  it("is null when Amazon fails", async () => {
    reply = () => ({ Routes: [] });
    expect(await walkMinutes({ lat: 19.06, lon: 72.83 }, CONDI)).toBeNull();
  });

  it("orders stops for the shortest walk, keeps a pinned first stop, and times each leg", async () => {
    reply = () => ({ Routes: [{ Legs: [{ PedestrianLegDetails: { Summary: { Overview: { Duration: 300 } } } }] }] });
    const a = { id: "a", lat: 19.06, lon: 72.83 };
    const far = { id: "far", lat: 19.07, lon: 72.83 };
    const mid = { id: "mid", lat: 19.065, lon: 72.83 };
    const out = await orderStops([far, a, mid]);
    expect(out.stops.map((s) => s.id)).toEqual(["far", "mid", "a"]);
    expect(out.walks).toEqual([5, 5]);
    const pinned = await orderStops([far, a, mid], { first: 1 });
    expect(pinned.stops.map((s) => s.id)).toEqual(["a", "mid", "far"]);
  });

  it("measures metres with haversine", () => {
    expect(Math.round(metresBetween({ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 }))).toBe(111);
  });
});
