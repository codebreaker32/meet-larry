import { meetErrorResponse, NO_STORE, readJson, sessionBodySchema } from "@/lib/meet/http";
import { closeMeet } from "@/lib/meet/service";

/**
 * POST /api/meet/[placeId]/close { sessionId } -> { ok }. Switches Open to meet off at once.
 * Needs no access code and has no rate limit: switching off must always work. Also sent with
 * navigator.sendBeacon when the page closes.
 */
export async function POST(request: Request) {
  try {
    const { sessionId } = sessionBodySchema.parse(await readJson(request));
    return Response.json(await closeMeet(sessionId), { headers: NO_STORE });
  } catch (err) {
    return meetErrorResponse(err);
  }
}
