import { e2eMeetDeps } from "@/lib/rooms/e2e-hooks";
import {
  assertMeetStorage,
  meetErrorResponse,
  NO_STORE,
  openBodySchema,
  placeFrom,
  meetBudget,
  readJson,
  requireMeetAccount,
  requireMeetCode,
  takeMeetLimit,
  takeOpenLimits,
  whereFrom,
} from "@/lib/meet/http";
import { openMeet } from "@/lib/meet/service";

/**
 * POST /api/meet/[placeId]/open { deviceId, persona, adult: true, visitToken, where: { lat, lon, accuracy } }
 *   -> { sessionId, expiresAt }.
 * Switches Open to meet on for 3 hours (opening again starts the 3 hours again, with the same
 * picks). Only for a signed-in account (accounts are 18+) with a verified check-in at this venue
 * (visitToken from /api/checkins/arrive). Refused without the 18+ confirmation, without picks, at a
 * place that isn't public, or when the phone's location doesn't show it at the venue (the location
 * is never stored).
 */
export async function POST(request: Request, ctx: { params: Promise<{ placeId: string }> }) {
  try {
    assertMeetStorage();
    const placeId = await placeFrom(ctx);
    takeMeetLimit(request, "open");
    const session = await requireMeetAccount(request);
    if (session instanceof Response) return session;
    const access = await requireMeetCode(request);
    if (access instanceof Response) return access;
    const body = openBodySchema.parse(await readJson(request));
    // A refused 18+ answer changes nothing, so only real attempts count against the code and phone.
    if (body.adult === true) takeOpenLimits(access.code, body.deviceId);
    const out = await openMeet(
      placeId,
      {
        deviceId: body.deviceId,
        uid: session.uid,
        visitToken: body.visitToken ?? "",
        persona: body.persona,
        adult: body.adult === true,
        where: whereFrom(request, body.where),
        code: access.code,
      },
      { ...e2eMeetDeps(request), budget: meetBudget(access.code) },
    );
    return Response.json(out, { headers: NO_STORE });
  } catch (err) {
    return meetErrorResponse(err);
  }
}
