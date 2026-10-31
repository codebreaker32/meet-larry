import { e2eMeetDeps } from "@/lib/rooms/e2e-hooks";
import { assertMeetStorage, meetBudget, meetErrorResponse, NO_STORE, placeFrom, requireMeetAccount, requireMeetCode, takeMeetLimit, whereFrom } from "@/lib/meet/http";
import { listNearby, venueInfo } from "@/lib/meet/service";

type Ctx = { params: Promise<{ placeId: string }> };

/**
 * GET /api/meet/[placeId] with the visit's session in the x-meet-session header (never the query
 * string, so the bearer token stays out of URLs, history, logs and Referer headers)
 * and the phone's fix in x-meet-where ("lat,lon,accuracy"; checked, never stored):
 *   -> { venue, expiresAt, groups: { groupId, kind, thing, count, line, witty: { line, plain }, waved }[], matches }
 * Anonymous counts per shared thing only ("2 people here like Ghibli"); never names, photos,
 * cards, per-person entries, times or counts of visits. A phone that has left the venue is
 * switched off (410). Without a session: { venue } only (the checked venue name).
 */
export async function GET(request: Request, ctx: Ctx) {
  try {
    assertMeetStorage();
    const placeId = await placeFrom(ctx);
    const session = request.headers.get("x-meet-session");
    if (!session) {
      takeMeetLimit(request, "venue");
      return Response.json(await venueInfo(placeId, e2eMeetDeps(request)), { headers: NO_STORE });
    }
    takeMeetLimit(request, "poll");
    const account = await requireMeetAccount(request);
    if (account instanceof Response) return account;
    const access = await requireMeetCode(request);
    if (access instanceof Response) return access;
    return Response.json(await listNearby(placeId, session, whereFrom(request), { ...e2eMeetDeps(request), budget: meetBudget(access.code) }), {
      headers: NO_STORE,
    });
  } catch (err) {
    return meetErrorResponse(err);
  }
}
