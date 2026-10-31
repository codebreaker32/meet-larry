import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addPlaceFits, daytimeSlots, findPlaces, hoursText, parseHours, placeVibe, ruleFit, type QlooEntity } from "./qloo";

// Qloo is stubbed; no model call is made (curate: false or no key).

const DAY = (opens: string, closes: string) => [{ opens: `T${opens}:00`, closes: `T${closes}:00`, closed: false }];
const WEEK = (opens: string, closes: string) =>
  Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => [d, DAY(opens, closes)]));

const tag = (id: string) => ({ id, name: id.split(":").pop() });
function place(id: string, name: string, cats: string[], extra: Partial<QlooEntity> & { more?: string[] } = {}): QlooEntity {
  const { more = [], ...rest } = extra;
  return {
    entity_id: id,
    name,
    types: ["urn:entity:place"],
    tags: [...cats.map((c) => tag(`urn:tag:category:place:${c}`)), ...more.map(tag)],
    location: { lat: 19.06, lon: 72.83 },
    query: { affinity: 0.6, explainability: { "signal.interests.entities": [{ entity_id: "a1", score: 0.7 }] } },
    ...rest,
  };
}

describe("placeVibe", () => {
  it("reads the noise tag first, then ambience, then the description, then the kind of place", () => {
    expect(placeVibe(place("1", "Hush", ["cafe"], { more: ["urn:tag:noise_level:qloo:quiet", "urn:tag:ambience:qloo:lively"] }))).toBe("calm");
    expect(placeVibe(place("2", "Loud", ["cafe"], { more: ["urn:tag:noise_level:qloo:loud"] }))).toBe("lively");
    // San Churro, live: moderate noise, cozy / comfortable / welcoming.
    expect(
      placeVibe(place("3", "Churros", ["cafe"], { more: ["urn:tag:noise_level:qloo:moderate", "urn:tag:ambience:qloo:cozy", "urn:tag:ambience:qloo:welcoming"] })),
    ).toBe("cosy");
    expect(placeVibe(place("4", "Buzz", ["cafe"], { properties: { ambience_description: "Energetic and buzzing all day." } }))).toBe("lively");
    expect(placeVibe(place("5", "Books", ["library"]))).toBe("calm");
  });
});

describe("opening hours", () => {
  it("turns Qloo's hours into easy-read text and daytime chips, never late or near closing", () => {
    const week = parseHours({ ...WEEK("09:00", "21:00"), saturday: DAY("10:00", "16:00"), sunday: [{ closed: true }] })!;
    expect(hoursText(week)).toBe("Mon-Fri 9am-9pm, Sat 10am-4pm, Sun closed");
    // Thursday 30 Oct 2026: chips start tomorrow (Fri), weekends late morning, weekdays after school.
    const slots = daytimeSlots(week, new Date(2026, 9, 29, 12));
    expect(slots).toEqual(["Fri 5pm", "Sat 11am", "Mon 5pm"]);
  });

  it("handles closing after midnight and says nothing when Qloo has no hours", () => {
    const late = parseHours(WEEK("12:00", "01:30"))!;
    expect(hoursText(late)).toBe("Daily 12pm-1:30am");
    expect(parseHours(null)).toBeUndefined();
  });
});

describe("findPlaces: PlaceCards", () => {
  beforeEach(() => vi.stubEnv("QLOO_KEY", "test"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const stub = (byRadius: (radius: number, tags: string) => QlooEntity[]) => {
    const f = vi.fn(async (url: URL | string) => {
      const p = new URL(String(url)).searchParams;
      const entities = byRadius(Number(p.get("filter.location.radius")), p.get("filter.tags") ?? "");
      return new Response(JSON.stringify({ results: { entities } }), { status: 200 });
    });
    vi.stubGlobal("fetch", f);
    return f;
  };

  it("drops nightlife, evening-only, closed-every-day and far places, and keeps vibe, tags, hours and slots", async () => {
    stub((_r, tags) =>
      tags.includes(":cafe")
        ? [
            // 145 Bandra, live: a café and bar tagged nightlife.
            place("bar", "145 Bandra", ["cafe", "bar"], { more: ["urn:tag:interests:qloo:nightlife"] }),
            place("late", "Night Owl Café", ["cafe"], { properties: { hours: WEEK("18:00", "02:00") } }),
            place("shut", "Bombay Coffee House", ["cafe"], {
              properties: { hours: Object.fromEntries(Object.keys(WEEK("09:00", "17:00")).map((d) => [d, [{ closed: true }]])) },
            }),
            place("far", "Far Café", ["cafe"], { location: { lat: 19.2, lon: 72.83 } }),
            place("ok", "Churros", ["cafe"], {
              more: ["urn:tag:noise_level:qloo:moderate", "urn:tag:ambience:qloo:cozy", "urn:tag:amenities:place:wi_fi"],
              properties: { hours: WEEK("09:00", "21:00"), image: { url: "https://images.qloo.com/i/x.jpg" } },
            }),
          ]
        : [],
    );
    const places = await findPlaces([{ id: "a1", name: "Minecraft" }], 19.06, 72.83, { maxRadius: 3000 });
    expect(places.map((p) => p.id)).toEqual(["ok"]);
    expect(places[0]).toMatchObject({ vibe: "cosy", tags: ["Café", "Wi-Fi"], hours: "Daily 9am-9pm", distanceKm: 0, fits: [] });
    expect(places[0].slots?.length).toBe(3);
  });

  it("looks within 3 km first and widens once only when too few are left", async () => {
    const f = stub((r, tags) => (tags.includes(":book_store") ? [place(`b${r}`, `Books ${r}`, ["book_store"])] : []));
    const places = await findPlaces([{ id: "a1", name: "Minecraft" }], 19.06, 72.83, { take: 2, vary: false });
    const radii = f.mock.calls.map(([u]) => Number(new URL(String(u)).searchParams.get("filter.location.radius")));
    expect(radii.slice(0, 4)).toEqual([3000, 3000, 3000, 3000]);
    expect(radii.slice(4)).toEqual([7000, 7000, 7000, 7000]);
    expect(places.map((p) => p.id)).toEqual(["b3000", "b7000"]);
  });

  it("varies equally calm places by signal, so two people don't get the same first pick", async () => {
    const cafes = Array.from({ length: 6 }, (_, i) => place(`c${i}`, `Café ${i}`, ["cafe"]));
    stub((_r, tags) => (tags.includes(":cafe") ? cafes : []));
    const firsts = new Set<string>();
    for (const sig of ["a1", "b2", "c3", "d4", "e5", "f6"]) {
      const [first] = await findPlaces([{ id: sig, name: "Pick" }], 19.06, 72.83, { take: 1, maxRadius: 3000 });
      firsts.add(first.id);
    }
    expect(firsts.size).toBeGreaterThan(1);
    // The same signal always gets the same list.
    const again = await findPlaces([{ id: "a1", name: "Pick" }], 19.06, 72.83, { take: 3, maxRadius: 3000 });
    expect(await findPlaces([{ id: "a1", name: "Pick" }], 19.06, 72.83, { take: 3, maxRadius: 3000 })).toEqual(again);
  });
});

describe("per-person fit", () => {
  const card = { id: "p", name: "Arcade", tags: [], affinity: 0.5, vibe: "lively" as const, fits: [] };

  it("says not-for-them when the vibe clashes, likes when it matches or Qloo ranks it high", () => {
    const calmSam = { who: "a", name: "Sam", items: [], persona: { dislikes: [], notes: [], placeVibe: "calm" as const } };
    expect(ruleFit(card, calmSam)).toMatchObject({ likely: "not-for-them" });
    const livelyJo = { who: "b", name: "Jo", items: [], persona: { dislikes: [], notes: [], placeVibe: "lively" as const } };
    expect(ruleFit(card, livelyJo, { pick: "Celeste", topHalf: false })).toEqual({ who: "b", likely: "likes", why: "Lively, and it goes with Celeste." });
    expect(ruleFit(card, { who: "c", name: "Ana", items: [] }, { pick: "Coco", topHalf: true })).toMatchObject({ likely: "likes", why: "It goes with Coco." });
    // Never the templated "fans of X go here" that reads as made up.
    for (const fit of [ruleFit(card, livelyJo, { pick: "Celeste", topHalf: true }), ruleFit(card, { who: "c", name: "Ana", items: [] }, { pick: "Coco", topHalf: false })]) {
      expect(fit.why).not.toMatch(/fans of/i);
    }
    expect(ruleFit(card, { who: "c", name: "Ana", items: [] })).toMatchObject({ likely: "maybe" });
  });

  it("asks Qloo once per person about exactly these places", async () => {
    vi.stubEnv("QLOO_KEY", "test");
    const f = vi.fn(async (url: URL | string) => {
      const p = new URL(String(url)).searchParams;
      expect(p.get("filter.results.entities")).toBe("p");
      const who = p.get("signal.interests.entities");
      return new Response(
        JSON.stringify({ results: { entities: [{ entity_id: "p", name: "Arcade", query: { affinity: 0.7, explainability: { "signal.interests.entities": [{ entity_id: who, score: 1 }] } } }] } }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", f);
    const [out] = await addPlaceFits([card], [
      { who: "a", name: "Sam", items: [{ id: "a1", name: "Minecraft" }] },
      { who: "b", name: "Priya", items: [{ id: "b1", name: "Fleet Foxes" }] },
    ], { curate: false });
    expect(f).toHaveBeenCalledTimes(2);
    expect(out.fits).toEqual([
      { who: "a", likely: "likes", why: "It goes with Minecraft." },
      { who: "b", likely: "likes", why: "It goes with Fleet Foxes." },
    ]);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});
