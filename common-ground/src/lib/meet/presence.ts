// Proof of presence for Open to meet (PRODUCT.md "No stalking possible"). The phone sends its
// location with every open, poll and wave; the server checks it against the venue's own
// coordinates (from Qloo) and throws it away straight after. Nothing here stores, logs or
// returns a location. Shared by server and client, so nothing server-only lives here.
import { MEET_ACCURACY_MAX_M, MEET_NEAR_M, MEET_SLACK_M } from "./config";

/** Where the phone says it is right now. Never stored. */
export interface Where {
  lat: number;
  lon: number;
  /** GPS accuracy in metres (the radius the phone is sure of). */
  accuracy: number;
}

export type PresenceResult = "here" | "away" | "fuzzy";

/** Metres between two points (haversine). */
export function metresBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Whether a fix shows the phone at the venue: "fuzzy" when the fix is too rough to tell. */
export function presenceAt(venue: { lat: number; lon: number }, where: Where): PresenceResult {
  if (!(where.accuracy >= 0) || where.accuracy > MEET_ACCURACY_MAX_M) return "fuzzy";
  return metresBetween(venue, where) <= MEET_NEAR_M + Math.min(where.accuracy, MEET_SLACK_M) ? "here" : "away";
}

/** A fix from a header or body: "lat,lon,accuracy". Null when it isn't one. */
export function parseWhere(raw: unknown): Where | null {
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    return valid(Number(o.lat), Number(o.lon), Number(o.accuracy));
  }
  if (typeof raw !== "string" || raw.length > 80) return null;
  const [lat, lon, accuracy] = raw.split(",").map(Number);
  return valid(lat, lon, accuracy);
}

function valid(lat: number, lon: number, accuracy: number): Where | null {
  if (![lat, lon, accuracy].every(Number.isFinite)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || accuracy < 0) return null;
  return { lat, lon, accuracy };
}

/** The header the meet page sends its fix in (a header keeps it out of URLs and logs). */
export const WHERE_HEADER = "x-meet-where";
export const whereHeaderValue = (w: Where) => `${w.lat.toFixed(6)},${w.lon.toFixed(6)},${Math.round(w.accuracy)}`;
