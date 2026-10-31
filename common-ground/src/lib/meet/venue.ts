import "server-only";
import { getMeetKv } from "./kv";

// The venue behind a meet page, checked with Qloo: it must be a real, open, public place. Its
// name comes from Qloo, never from the phone, so nobody can call "my flat" a venue and have
// Larry suggest meeting there.

export interface Venue {
  id: string;
  name: string;
  /** The venue's own coordinates from Qloo (public business data), for the presence check. */
  lat: number;
  lon: number;
}

export class VenueError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Qloo place ids are UUIDs. */
export const PLACE_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

/** Not open to everyone, or not a place to meet a stranger: never. */
const NOT_PUBLIC =
  /:(college|university|school|high_school|primary_school|hostel|hotel|motel|apartment|apartment_building|residential|housing|dormitory|night_club|nightclub|strip_club|adult_entertainment|hookah_bar|casino|hospital|clinic)$/;
/** Built around alcohol: only fine when it is also a café, bookshop, library or games place. */
const DRINKING = /:(bar|pub|cocktail_bar|wine_bar|lounge|brewery|beer_garden|sports_bar)$/;
const HANGOUT = /:(cafe|coffee_shop|coffee_store|tea_house|art_cafe|book_store|comic_book_store|library|public_library|board_game_club|video_arcade|game_store|museum|art_gallery|park)$/;

const VENUE_TTL_MS = 24 * 60 * 60 * 1000;
const BASE = () => (process.env.QLOO_SERVER_URL ?? "https://hackathon.api.qloo.com").replace(/\/$/, "");

interface QlooPlace {
  entity_id: string;
  name: string;
  types?: string[];
  tags?: { tag_id?: string; id?: string }[];
  properties?: { is_closed?: boolean; primary_genre?: { id?: string } };
  location?: { lat?: number; lon?: number };
}

export type FetchPlace = (placeId: string) => Promise<QlooPlace | null>;

/** One Qloo /entities call. Null when Qloo doesn't know the id. */
export const fetchQlooPlace: FetchPlace = async (placeId) => {
  const key = process.env.QLOO_KEY;
  if (!key) throw new VenueError(503, "Places aren't set up yet. Try again later.");
  const url = new URL(BASE() + "/entities");
  url.searchParams.set("entity_ids", placeId);
  const res = await fetch(url, { headers: { "X-Api-Key": key }, cache: "no-store", signal: AbortSignal.timeout(8_000) });
  if (res.status === 429) throw new VenueError(429, "Larry's a little busy finding things right now. Try again in a minute?");
  if (!res.ok) throw new VenueError(502, "Couldn't check this place. Try again.");
  const body = (await res.json().catch(() => null)) as { results?: QlooPlace[] } | null;
  return body?.results?.find((e) => e.entity_id?.toLowerCase() === placeId.toLowerCase()) ?? null;
};

/** Whether Qloo's data says strangers may meet here: a place, open, and public. */
export function isMeetableVenue(p: QlooPlace): boolean {
  if (!(p.types ?? []).includes("urn:entity:place")) return false;
  if (p.properties?.is_closed) return false;
  const ids = [p.properties?.primary_genre?.id, ...(p.tags ?? []).map((t) => t.tag_id ?? t.id)].filter(Boolean) as string[];
  const kinds = ids.filter((id) => /^urn:tag:(genre|category):place:/.test(id));
  if (kinds.some((id) => NOT_PUBLIC.test(id))) return false;
  return !kinds.some((id) => DRINKING.test(id)) || kinds.some((id) => HANGOUT.test(id));
}

/** The checked venue (cached for a day). Throws VenueError when it can't be used. */
export async function getVenue(placeId: string, fetchPlace: FetchPlace = fetchQlooPlace): Promise<Venue> {
  if (!PLACE_ID_RE.test(placeId)) throw new VenueError(404, "We couldn't find this place.");
  const kv = getMeetKv();
  const cacheKey = `venue:${placeId.toLowerCase()}`;
  const cached = await kv.get<Venue | { bad: true }>(cacheKey);
  if (cached && "bad" in cached) throw new VenueError(403, "Open to meet only works at public places like cafés, libraries and shops.");
  if (cached && Number.isFinite(cached.lat) && Number.isFinite(cached.lon)) return cached;
  const p = await fetchPlace(placeId);
  if (!p) throw new VenueError(404, "We couldn't find this place.");
  const lat = Number(p.location?.lat);
  const lon = Number(p.location?.lon);
  // Without the venue's own coordinates nobody can show they are there, so it can't be used.
  const located = Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0);
  if (!isMeetableVenue(p) || !located) {
    await kv.update(cacheKey, () => ({ bad: true as const }), VENUE_TTL_MS);
    throw new VenueError(403, "Open to meet only works at public places like cafés, libraries and shops.");
  }
  const venue: Venue = {
    id: p.entity_id,
    name: String(p.name).replace(/[\p{C}\[\]<>]/gu, "").slice(0, 80).trim() || "this place",
    lat,
    lon,
  };
  await kv.update(cacheKey, () => venue, VENUE_TTL_MS);
  return venue;
}
