import { type CodeParams, codeFrom, larryBodySchema, NO_STORE, readJson, roomErrorResponse } from "@/lib/rooms/http";
import { takeRoomLimit } from "@/lib/rooms/limits";
import { setLarryAway } from "@/lib/rooms/service";

/**
 * POST /api/rooms/[code]/larry { memberId, token, away } -> { room }.
 * "Excuse Larry" (away: true): Larry reads and answers nothing in the room until "Hello Larry"
 * (away: false), and then starts fresh. Room-wide: every member's phone shows the same state.
 */
export async function POST(request: Request, ctx: CodeParams) {
  try {
    const code = await codeFrom(request, ctx);
    const body = larryBodySchema.parse(await readJson(request));
    takeRoomLimit(request, "message", code);
    const result = await setLarryAway(code, body.memberId, body.token, body.away);
    return Response.json(result, { headers: NO_STORE });
  } catch (err) {
    return roomErrorResponse(err, request);
  }
}
