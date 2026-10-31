import { e2eMeetDeps } from "@/lib/rooms/e2e-hooks";
import { assertMeetStorage, meetErrorResponse, NO_STORE, placeFrom, readJson, requireMeetAccount, requireMeetCode, takeMeetLimit, waveBodySchema, whereFrom } from "@/lib/meet/http";
import { wave } from "@/lib/meet/service";

/**
 * POST /api/meet/[placeId]/wave { sessionId, groupId, where }
 *   -> { mutual: false, already? } | { mutual: true, roomCode, credentials }.
 * A wave at everyone counted under one shared thing, one wave per person per visit. When one of
 * them waved back, a room opens with the two people and Larry. Only from a phone at the venue.
 */
export async function POST(request: Request, ctx: { params: Promise<{ placeId: string }> }) {
  try {
    assertMeetStorage();
    const placeId = await placeFrom(ctx);
    takeMeetLimit(request, "wave");
    const account = await requireMeetAccount(request);
    if (account instanceof Response) return account;
    const access = await requireMeetCode(request);
    if (access instanceof Response) return access;
    const { sessionId, groupId, where } = waveBodySchema.parse(await readJson(request));
    return Response.json(await wave(placeId, sessionId, groupId, whereFrom(request, where), e2eMeetDeps(request)), { headers: NO_STORE });
  } catch (err) {
    return meetErrorResponse(err);
  }
}
