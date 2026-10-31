import { type IdParams, NO_STORE, groupErrorResponse, groupIdFrom, openAfter, requireSession, takeLimit } from "@/lib/groups/http";
import { readGroup } from "@/lib/groups/service";

export const maxDuration = 60;

/**
 * GET /api/groups/[id]?since=<version> (member) -> { unchanged: true } | { group, messages }.
 * Poll every few seconds. Messages from before you joined, or older than 30 days, never come back.
 */
export async function GET(request: Request, ctx: IdParams) {
  try {
    const s = await requireSession(request);
    takeLimit(s.uid, "poll");
    const id = await groupIdFrom(ctx);
    const raw = new URL(request.url).searchParams.get("since");
    const since = raw !== null && /^\d{1,12}$/.test(raw) ? Number(raw) : undefined;
    const out = await readGroup(s.uid, id, { ...(since !== undefined ? { since } : {}), onNeedsOpening: () => openAfter(request, id) });
    return Response.json(out, { headers: NO_STORE });
  } catch (err) {
    return groupErrorResponse(err);
  }
}
