import { type IdParams, NO_STORE, groupErrorResponse, groupIdFrom, memberActionSchema, readJson, requireSession, takeLimit } from "@/lib/groups/http";
import { memberAction } from "@/lib/groups/service";

/**
 * POST /api/groups/[id]/members { action, memberId, reason?, note? } (member) -> { ok }.
 *   remove (creator only), unfriend (you leave every group you share), block (and never share a
 *   group again), report (kept 30 days for review with the last messages). All silent and immediate.
 */
export async function POST(request: Request, ctx: IdParams) {
  try {
    const s = await requireSession(request);
    takeLimit(s.uid, "manage");
    const id = await groupIdFrom(ctx);
    const body = memberActionSchema.parse(await readJson(request));
    await memberAction(s.uid, id, body);
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    return groupErrorResponse(err);
  }
}
