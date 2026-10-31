import { type IdParams, NO_STORE, groupErrorResponse, groupIdFrom, requireSession, takeLimit } from "@/lib/groups/http";
import { leaveGroup } from "@/lib/groups/service";

/** POST /api/groups/[id]/leave (member) -> { ok }. Silent and immediate: nobody is told. */
export async function POST(request: Request, ctx: IdParams) {
  try {
    const s = await requireSession(request);
    takeLimit(s.uid, "manage");
    await leaveGroup(s.uid, await groupIdFrom(ctx));
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    return groupErrorResponse(err);
  }
}
