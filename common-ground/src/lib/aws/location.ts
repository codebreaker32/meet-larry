import "server-only";
import { daytimeSlots, hoursText, type WeekHours } from "@/lib/qloo";

// Amazon Location enrichment (D22). Qloo picks the place; Amazon only fills in what Qloo lacks:
// opening hours (and whether it is open right now), a cross-checked pin, walking time between two
// points and the order of a multi-stop plan. Any failure returns nothing, so the caller keeps the
// Qloo-only ticket. Server only: the key never reaches the browser. Walks are cached for 24 h; place matches (with open-now) for 30 min.
// Locations sent here are a place's own coordinates, never a person's live position for storage.

const TIMEOUT_MS = 4000;
const CACHE_MS = 24 * 60 * 60 * 1000;
/** The Amazon result counts as the same venue only within this distance of the Qloo pin. */
export const SAME_VENUE_M = 150;
/** Token overlap that counts as the same name when neither name contains the other. */
const NAME_OVERLAP = 0.6;

export interface LatLon {
  lat: number;
  lon: number;
}

/** What enrichPlace needs: the Qloo name and pin, and Qloo's hours if it had them. */
export interface EnrichInput {
  name: string;
  lat?: number;
  lon?: number;
  /** Qloo's hours text. When set, Amazon's hours are not borrowed. */
  hours?: string;
}

export interface Enrichment {
  /** Easy-read hours from Amazon, e.g. "Daily 10:30am-7:30pm" (only when Qloo had none). */
  hours?: string;
  /** 2-3 daytime chips from Amazon's hours, e.g. "Sat 11am" (only when hours were borrowed). */
  slots?: string[];
  /** Amazon's open-right-now flag for the matched venue; null when unknown. */
  openNow?: boolean | null;
  /** Amazon's pin for the matched venue (a cross-check for the Qloo pin). */
  pin?: LatLon;
}

// ---------------------------------------------------------------- config + http

function config(): { key: string; region: string } | null {
  const key = process.env.AWS_LOCATION_API_KEY;
  if (!key) return null;
  return { key, region: process.env.AWS_LOCATION_REGION || "ap-south-1" };
}

async function post(service: "places" | "routes", path: string, body: unknown): Promise<unknown> {
  const cfg = config();
  if (!cfg) throw new Error("location: not configured");
  const url = `https://${service}.geo.${cfg.region}.amazonaws.com${path}?key=${encodeURIComponent(cfg.key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  // The URL holds the key: never put it in an error message.
  if (!res.ok) throw new Error(`location: ${service} ${res.status}`);
  return res.json();
}

/** How long a place match (with its OpenNow flag) stays fresh. */
const OPEN_NOW_TTL_MS = 30 * 60 * 1000;

const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, load: () => Promise<T>, ttlMs: number = CACHE_MS): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 2000) cache.delete(cache.keys().next().value as string);
  return value;
}

/** Test hook: forget every cached answer. */
export function clearLocationCache(): void {
  cache.clear();
}

// ---------------------------------------------------------------- geometry + names

/** Metres between two points (haversine). */
export function metresBetween(a: LatLon, b: LatLon): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const normName = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * Words that say what kind of place it is, not which one. Two venues sharing only these ("The Irish
 * House" and "The Beer House") are different places.
 */
const GENERIC_WORDS = new Set([
  "the", "a", "an", "and", "of", "at", "by", "n",
  "cafe", "caffe", "coffee", "bar", "house", "restaurant", "pub", "kitchen", "bistro", "lounge", "club", "co", "company", "shop", "store",
]);

const distinctive = (words: string[]) => words.filter((w) => !GENERIC_WORDS.has(w));

/** True when `inner` appears in `outer` as whole words, in order. */
function containsWords(outer: string[], inner: string[]): boolean {
  if (!inner.length || inner.length > outer.length) return false;
  for (let i = 0; i + inner.length <= outer.length; i++) if (inner.every((w, j) => outer[i + j] === w)) return true;
  return false;
}

/**
 * Case and punctuation-insensitive (D22 name rule). The same name; or one name inside the other as
 * whole words, when the shorter one has 2+ words and at least 1 distinctive one; or the distinctive words
 * (generic ones such as "the", "cafe", "house" left out) overlap by 60%+ of the larger set.
 */
export function sameName(a: string, b: string): boolean {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const wx = x.split(" ");
  const wy = y.split(" ");
  const [short, long] = wx.length <= wy.length ? [wx, wy] : [wy, wx];
  if (short.length >= 2 && distinctive(short).length >= 1 && containsWords(long, short)) return true;
  const tx = new Set(distinctive(wx));
  const ty = new Set(distinctive(wy));
  if (!tx.size || !ty.size) return false;
  const shared = [...tx].filter((t) => ty.has(t)).length;
  return shared > 0 && shared / Math.max(tx.size, ty.size) >= NAME_OVERLAP;
}

const valid = (p?: Partial<LatLon> | null): p is LatLon =>
  !!p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat!) <= 90 && Math.abs(p.lon!) <= 180;

// ---------------------------------------------------------------- opening hours

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function dayIndex(token: string): number {
  return DAYS.indexOf(token.trim().slice(0, 3).toLowerCase());
}

function minutes(t: string): number | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
}

/**
 * Amazon's OpeningHours Display lines as week spans (Monday first), or undefined when nothing
 * parses. Lines look like "Mon-Sun: 10:30 - 19:30", "Mon, Wed-Fri: 09:00 - 13:00, 14:00 - 18:00",
 * "Daily: 08:00 - 20:00" or "Sun: Closed". A close at or before the open runs past midnight.
 */
export function parseAmazonHours(display: unknown): WeekHours | undefined {
  if (!Array.isArray(display)) return undefined;
  const week: WeekHours = DAYS.map(() => []);
  let any = false;
  for (const line of display) {
    if (typeof line !== "string") continue;
    const cut = line.indexOf(": ");
    if (cut < 0) continue;
    const daysPart = line.slice(0, cut).trim();
    const timesPart = line.slice(cut + 2).trim();
    const days = new Set<number>();
    if (/^(daily|every ?day)$/i.test(daysPart)) DAYS.forEach((_, i) => days.add(i));
    for (const tok of daysPart.split(",")) {
      const [from, to] = tok.split(/\s*[-–]\s*/);
      const a = dayIndex(from ?? "");
      if (a < 0) continue;
      const b = to ? dayIndex(to) : a;
      if (b < 0) continue;
      for (let i = a; ; i = (i + 1) % 7) {
        days.add(i);
        if (i === b) break;
      }
    }
    if (!days.size) continue;
    if (/closed/i.test(timesPart)) {
      any = true;
      continue;
    }
    const spans = /24 ?hours|open 24/i.test(timesPart)
      ? [{ open: 0, close: 1440 }]
      : timesPart.split(",").flatMap((range) => {
          const [o, c] = range.split(/\s*[-–]\s*/);
          const open = minutes(o ?? "");
          const close = minutes(c ?? "");
          if (open === undefined || close === undefined) return [];
          return [{ open, close: close <= open ? close + 1440 : close }];
        });
    if (!spans.length) continue;
    any = true;
    for (const d of days) week[d].push(...spans);
  }
  return any ? week : undefined;
}

// ---------------------------------------------------------------- places

interface AmazonItem {
  Title?: string;
  Position?: [number, number];
  OpeningHours?: { Display?: string[]; OpenNow?: boolean }[] | null;
}

/**
 * Amazon's view of a Qloo place: hours (only when Qloo has none), open-now and a pin. Borrowed only
 * when an Amazon result has the same name AND sits within 150 m of the Qloo pin. Never throws:
 * without a key, a pin, a match, or on any error it returns {} and the ticket stays Qloo-only.
 */
export async function enrichPlace(place: EnrichInput, now: Date = new Date()): Promise<Enrichment> {
  const at = { lat: place.lat, lon: place.lon };
  if (!config() || !valid(at) || !place.name?.trim()) return {};
  try {
    const key = `place:${normName(place.name)}:${at.lat.toFixed(4)},${at.lon.toFixed(4)}`;
    const match = await cached(key, async () => {
      const body = (await post("places", "/v2/search-text", {
        QueryText: place.name.slice(0, 200),
        BiasPosition: [at.lon, at.lat],
        AdditionalFeatures: ["Contact"],
        MaxResults: 5,
      })) as { ResultItems?: AmazonItem[] };
      const items = body.ResultItems ?? [];
      const hit = items.find((r) => {
        const pos = r.Position;
        if (!r.Title || !Array.isArray(pos)) return false;
        const pin = { lat: pos[1], lon: pos[0] };
        return valid(pin) && sameName(place.name, r.Title) && metresBetween(at, pin) <= SAME_VENUE_M;
      });
      if (!hit) return null;
      return {
        pin: { lat: hit.Position![1], lon: hit.Position![0] },
        display: hit.OpeningHours?.[0]?.Display ?? null,
        openNow: typeof hit.OpeningHours?.[0]?.OpenNow === "boolean" ? hit.OpeningHours[0].OpenNow : null,
      };
      // Amazon's OpenNow goes stale within the hour, and check-in uses it to refuse a closed venue,
      // so a place match is kept for 30 minutes, not the usual 24 hours.
    }, OPEN_NOW_TTL_MS);
    if (!match) return {};
    const out: Enrichment = { pin: match.pin, openNow: match.openNow };
    if (!place.hours) {
      const week = parseAmazonHours(match.display);
      if (week) {
        out.hours = hoursText(week);
        out.slots = daytimeSlots(week, now);
      }
    }
    return out;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------- routes

/**
 * Walking minutes between two points (Amazon Routes, pedestrian), rounded up, at least 1. Null
 * on any failure, so the caller can say nothing rather than guess.
 */
export async function walkMinutes(from: LatLon, to: LatLon): Promise<number | null> {
  if (!config() || !valid(from) || !valid(to)) return null;
  try {
    const key = `walk:${from.lat.toFixed(4)},${from.lon.toFixed(4)}>${to.lat.toFixed(4)},${to.lon.toFixed(4)}`;
    return await cached(key, async () => {
      const body = (await post("routes", "/v2/routes", {
        Origin: [from.lon, from.lat],
        Destination: [to.lon, to.lat],
        TravelMode: "Pedestrian",
        LegAdditionalFeatures: ["Summary"],
      })) as {
        Routes?: { Legs?: { PedestrianLegDetails?: { Summary?: { Overview?: { Duration?: number } } } }[] }[];
      };
      const seconds = body.Routes?.[0]?.Legs?.[0]?.PedestrianLegDetails?.Summary?.Overview?.Duration;
      if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) throw new Error("location: no duration");
      return Math.max(1, Math.ceil(seconds / 60));
    });
  } catch {
    return null;
  }
}

/** Easy-read walking time: "12 min walk". */
export const walkLabel = (min: number) => `${Math.max(1, Math.round(min))} min walk`;

export interface OrderedStops<T> {
  /** The stops in walking order. */
  stops: T[];
  /** Walking minutes from each stop to the next (length stops-1); null where Amazon could not tell. */
  walks: (number | null)[];
}

/**
 * The shortest walking order for a short multi-stop plan (2-4 stops). `first` pins the opening
 * stop (e.g. the café), else every start is tried. The order uses straight-line distance (no API
 * calls); the leg times come from walkMinutes. Stops without a valid pin keep their place at the end.
 */
export async function orderStops<T extends Partial<LatLon>>(stops: T[], options: { first?: number } = {}): Promise<OrderedStops<T>> {
  const placed = stops.filter((s) => valid(s));
  const rest = stops.filter((s) => !valid(s));
  const pinned = options.first !== undefined && valid(stops[options.first]) ? stops[options.first] : undefined;
  let best = placed;
  if (placed.length >= 2 && placed.length <= 6) {
    let bestLen = Infinity;
    for (const perm of permutations(placed)) {
      if (pinned && perm[0] !== pinned) continue;
      let len = 0;
      for (let i = 1; i < perm.length; i++) len += metresBetween(perm[i - 1] as LatLon, perm[i] as LatLon);
      if (len < bestLen) {
        bestLen = len;
        best = perm;
      }
    }
  }
  const walks = await Promise.all(best.slice(1).map((s, i) => walkMinutes(best[i] as LatLon, s as LatLon)));
  const all = [...best, ...rest];
  return { stops: all, walks: all.slice(1).map((_, i) => walks[i] ?? null) };
}

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}
