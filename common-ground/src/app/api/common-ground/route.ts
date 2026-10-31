import { errorResponse, optionalLease, readJsonBody } from "@/lib/http";
import { findCommonGround } from "@/lib/qloo";
import { rateLimit } from "@/lib/rate-limit";
import { commonGroundSignalsSchema } from "@/lib/schemas";

// The model can take a few seconds to curate the candidates.
export const maxDuration = 60;

/** What one curation is reserved against the access code (suggest.ts CURATE_ESTIMATE_USD). */
const CURATE_RESERVE_USD = 0.06;

/**
 * POST /api/common-ground { a, b, personas?: { a?, b? }, signals? } -> CommonGround.
 * `signals` (the asker's own mood, age range and Hidden Gems) shape what Qloo returns: Hidden Gems
 * sets filter.popularity.max, age goes to signal.demographics.age, mood leans the tags.
 * Qloo finds the candidates; with a usable access code Larry curates them (the 6-8 that fit both
 * people, each with a specific `why`, charged to the code). Without one, or if the model fails,
 * Qloo's own ranking comes back with a plainer `why`: common ground never needs the model.
 */
export async function POST(request: Request) {
  try {
    const limited = rateLimit(request, "qloo");
    if (limited) return limited;
    const { a, b, personas, signals } = commonGroundSignalsSchema.parse(await readJsonBody(request));
    // Curation is a model call: its own per-IP limit with a daily cap, and a lease on the code
    // (one of a few runs at once, within its budget). Without either, Qloo's ranking comes back.
    const lease = await optionalLease(request, CURATE_RESERVE_USD, { limit: "curate" });
    try {
      return Response.json(
        await findCommonGround(a, b, undefined, { curate: !!lease, charge: lease?.charge, personas, signal: request.signal, signals }),
      );
    } finally {
      lease?.release();
    }
  } catch (err) {
    return errorResponse(err);
  }
}
