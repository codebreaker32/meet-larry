import { podiumMineSchema } from "@/lib/schemas";
import { NO_STORE, groupErrorResponse, readJson, requireSession, takeLimit } from "@/lib/groups/http";
import { removeMine } from "@/lib/people/podium";

/**
 * DELETE /api/podium/mine { keys: [{ placeId, key }] } (account) -> { ok }: "Leave podiums", and the
 * first step of account deletion. The server can't find anyone's entries by uid, so the device sends its keys.
 */
export async function DELETE(request: Request) {
  try {
    const s = await requireSession(request);
    takeLimit(s.uid, "manage");
    const { keys } = podiumMineSchema.parse(await readJson(request));
    await removeMine(keys);
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    return groupErrorResponse(err);
  }
}
