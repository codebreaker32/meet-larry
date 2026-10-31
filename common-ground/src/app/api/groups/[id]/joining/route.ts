import { z } from "zod";
import { type IdParams, NO_STORE, groupErrorResponse, groupIdFrom, openAfter, readJson, requireSession, takeLimit } from "@/lib/groups/http";
import { closeJoining, freshQr } from "@/lib/groups/service";

export const maxDuration = 60;

const bodySchema = z.object({ action: z.enum(["open", "close"]) });

/**
 * POST /api/groups/[id]/joining (creator)
 *   { action: "open" }  -> { join }: a fresh QR for 15 minutes; every earlier QR stops working.
 *   { action: "close" } -> { group }: joining closes now. Larry opens a group of 2+ that hasn't been opened.
 */
export async function POST(request: Request, ctx: IdParams) {
  try {
    const s = await requireSession(request);
    takeLimit(s.uid, "manage");
    const id = await groupIdFrom(ctx);
    const { action } = bodySchema.parse(await readJson(request));
    if (action === "open") return Response.json({ join: await freshQr(s.uid, id) }, { headers: NO_STORE });
    const { group, formed } = await closeJoining(s.uid, id);
    if (formed) openAfter(request, id);
    return Response.json({ group }, { headers: NO_STORE });
  } catch (err) {
    return groupErrorResponse(err);
  }
}
