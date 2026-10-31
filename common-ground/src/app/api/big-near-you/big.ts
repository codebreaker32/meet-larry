import "server-only";
import { safeImage } from "@/lib/schemas";
import type { TasteItem } from "@/lib/types";
import { type AgeBucket, QLOO_AGE_MAP } from "@/lib/types/signals";

// "Big near you": films that are popular around the person's coarse area, for the picture row in
// card making (qloo-hooks-plan 3.5 A). Qloo /v2/insights + signal.location. Movies only: the one
// domain verified live; the other categories keep the static starter row. Honest naming: this is
// what is BIG near you, never "rising" or "trending in <city>" (Qloo has no city trend list).
// No model call. Cached per area cell and age band for 7 days. Coordinates are never logged.

const BASE = (process.env.QLOO_SERVER_URL ?? "https://hackathon.api.qloo.com").replace(/\/$/, "");
export const BIG_NEAR_YOU_TAKE = 12;
/** Only the well-known: a picture row someone recognises without reading. */
export const BIG_NEAR_YOU_POP_MIN = 0.9;
export const BIG_NEAR_YOU_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;

/** Round to 1 decimal (about 11 km): a city-scale cell, so the cache key and the Qloo call never hold a precise point. */
export const areaCell = (n: number) => Math.round(n * 10) / 10;

/** One Qloo age value (P1: Qloo takes one value; a comma list could make it ignore the signal). */
export function qlooAge(b: AgeBucket | undefined): string | undefined {
  return b ? QLOO_AGE_MAP[b].split(",")[0] : undefined;
}

interface Entity {
  entity_id?: string;
  name?: string;
  properties?: { image?: { url?: string } };
}

const cache = new Map<string, { at: number; items: TasteItem[] }>();
export const resetBigNearYouCache = () => cache.clear();

/** The films big around this area. Empty (never made up) when Qloo has nothing or fails. */
export async function bigNearYou(lat: number, lon: number, age?: AgeBucket, now = Date.now()): Promise<TasteItem[]> {
  const cLat = areaCell(lat);
  const cLon = areaCell(lon);
  const ageValue = qlooAge(age);
  const key = `${cLat},${cLon}|${ageValue ?? "-"}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < BIG_NEAR_YOU_TTL_MS) return hit.items;

  const qlooKey = process.env.QLOO_KEY;
  if (!qlooKey) return [];
  const url = new URL(`${BASE}/v2/insights`);
  url.searchParams.set("filter.type", "urn:entity:movie");
  url.searchParams.set("signal.location", `POINT(${cLon} ${cLat})`);
  url.searchParams.set("filter.popularity.min", String(BIG_NEAR_YOU_POP_MIN));
  url.searchParams.set("take", String(BIG_NEAR_YOU_TAKE));
  if (ageValue) url.searchParams.set("signal.demographics.age", ageValue);

  let items: TasteItem[] = [];
  try {
    const res = await fetch(url, { headers: { "X-Api-Key": qlooKey }, cache: "no-store" });
    if (!res.ok) return [];
    const body = (await res.json().catch(() => ({}))) as { results?: { entities?: Entity[] } };
    const seen = new Set<string>();
    for (const e of body.results?.entities ?? []) {
      if (!e.entity_id || !e.name || seen.has(e.entity_id)) continue;
      seen.add(e.entity_id);
      const name = e.name.trim().slice(0, 120);
      if (!name) continue;
      items.push({ id: e.entity_id, name, domain: "movie", image: safeImage(e.properties?.image?.url) });
    }
    items = items.slice(0, BIG_NEAR_YOU_TAKE);
  } catch {
    return [];
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: now, items });
  return items;
}
