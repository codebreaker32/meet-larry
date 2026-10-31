import { type CodeParams, codeFrom, NO_STORE, roomErrorResponse, runAfter } from "@/lib/rooms/http";
import { e2eGround } from "@/lib/rooms/e2e-hooks";
import { recordMiss, takeRoomLimit } from "@/lib/rooms/limits";
import { RoomError, readRoom, refreshGround } from "@/lib/rooms/service";

/**
 * GET /api/rooms/[code]?since=<version>.
 * Members send x-member-id and x-member-token headers (headers, not the query string, so tokens
 * stay out of logs) and get { room } or { unchanged: true }; this also tells the room they are
 * still here. Without them, only { preview } (names and open seats) for the join screen. Wrong
 * credentials answer 403 and count as a miss, like a code that doesn't exist.
 */
export async function GET(request: Request, ctx: CodeParams) {
  try {
    takeRoomLimit(request, "poll");
    const code = await codeFrom(request, ctx);
    const sinceRaw = new URL(request.url).searchParams.get("since");
    const since = sinceRaw !== null && /^\d{1,12}$/.test(sinceRaw) ? Number(sinceRaw) : undefined;
    const result = await readRoom(code, {
      since,
      memberId: request.headers.get("x-member-id"),
      token: request.headers.get("x-member-token"),
      // A common ground that failed (Qloo busy) is tried again, with backoff.
      onGroundStale: () => runAfter(() => refreshGround(code, e2eGround(request))),
    });
    return Response.json(result, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof RoomError && err.status === 403) recordMiss(request);
    return roomErrorResponse(err, request);
  }
}
