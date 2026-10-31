import { type CodeParams, codeFrom, leaveBodySchema, NO_STORE, readJson, roomErrorResponse, runAfter } from "@/lib/rooms/http";
import { takeRoomLimit } from "@/lib/rooms/limits";
import { e2eGround } from "@/lib/rooms/e2e-hooks";
import { leaveRoom, refreshGround } from "@/lib/rooms/service";

export const maxDuration = 60;

/** POST /api/rooms/[code]/leave { memberId, token } -> { ok: true }. The last one out closes the room. */
export async function POST(request: Request, ctx: CodeParams) {
  try {
    takeRoomLimit(request, "message");
    const code = await codeFrom(request, ctx);
    const { memberId, token } = leaveBodySchema.parse(await readJson(request));
    const { empty } = await leaveRoom(code, memberId, token);
    const find = e2eGround(request);
    if (!empty) runAfter(() => refreshGround(code, find));
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    return roomErrorResponse(err, request);
  }
}
