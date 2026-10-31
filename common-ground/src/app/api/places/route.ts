import { errorResponse, optionalLease, readJsonBody } from "@/lib/http";
import { type FitPerson, addPlaceFits, findPlaces, recentPlacesFrom } from "@/lib/qloo";
import { rateLimit } from "@/lib/rate-limit";
import { placesSignalsSchema } from "@/lib/schemas";

// Per-person fit can take a model call.
export const maxDuration = 60;

/** What one per-person fit call is reserved against the access code (suggest.ts FITS_ESTIMATE_USD). */
const FITS_RESERVE_USD = 0.04;

/**
 * POST /api/places -> { places: PlaceCard[] } (each with vibe, tags, hours, slots, distance).
 * Body: { lat, lon, items?: {id, name}[], members?: { id, profile, persona? }[], exclude?, radius?,
 * signals?, recentPlaces? }. `signals` are the asker's own (Hidden Gems and age go to Qloo, mood
 * moves the vibe order); `recentPlaces` go after fresh places. Places nobody here plausibly fits
 * (a devotional bookshop for two gamers, say) are left out.
 * With `members`, their picks are the signal and every place says for each member whether it is
 * likely for them (likes / maybe / not-for-them) and why: Qloo's per-person view, refined by Larry
 * when the request has a usable access code (charged to it).
 */
export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, "qloo");
    if (limited) return limited;
    const json = await readJsonBody(request);
    const { items, members, lat, lon, exclude, radius, signals } = placesSignalsSchema.parse(json);
    const recent = recentPlacesFrom(json);
    const people: FitPerson[] = (members ?? []).map((m) => ({
      who: m.id,
      name: m.persona?.name ?? m.profile.name,
      items: [...new Map([...m.profile.items, ...(m.persona?.likes.slice(0, 15) ?? [])].map((i) => [i.id, { id: i.id, name: i.name }])).values()],
      persona: m.persona,
    }));
    const signal = items?.length ? items : [...new Map(people.flatMap((p) => p.items).map((i) => [i.id, i])).values()];
    const tasteNames = (members ?? []).flatMap((m) => m.persona?.likes.map((l) => l.name) ?? []);
    const places = await findPlaces(signal, lat, lon, { exclude, signals, recent, tasteNames, ...(radius ? { radius } : {}) });
    if (!people.length) return Response.json({ places });
    // The fit refinement is a model call: its own per-IP limit with a daily cap, and a lease on the
    // code. Without either, the rule-based fits come back.
    const lease = await optionalLease(request, FITS_RESERVE_USD, { limit: "curate" });
    try {
      return Response.json({
        places: await addPlaceFits(places, people, { curate: !!lease, charge: lease?.charge, signal: request.signal }),
      });
    } finally {
      lease?.release();
    }
  } catch (err) {
    return errorResponse(err);
  }
}
