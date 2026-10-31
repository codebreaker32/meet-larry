import { blockBodySchema, meetErrorResponse, NO_STORE, readJson, takeMeetLimit } from "@/lib/meet/http";
import { block } from "@/lib/meet/service";

/**
 * POST /api/meet/block
 *   { sessionId, groupId }                             (from the nearby list: everyone in that group)
 *   { room: { code, memberId, token }, targetMemberId } (from inside any room)
 *   -> { ok }. Permanent and both ways: the two never see each other again, anywhere, and the
 * blocked person leaves any room they share. Needs no access code.
 */
export async function POST(request: Request) {
  try {
    takeMeetLimit(request, "safety");
    const body = blockBodySchema.parse(await readJson(request));
    return Response.json(await block(body), { headers: NO_STORE });
  } catch (err) {
    return meetErrorResponse(err);
  }
}
