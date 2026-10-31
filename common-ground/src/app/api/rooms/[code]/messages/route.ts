import {
  type CodeParams,
  codeFrom,
  groundFinder,
  messageBodySchema,
  NO_STORE,
  readJson,
  RoomAccessError,
  roomErrorResponse,
  runAfter,
} from "@/lib/rooms/http";
import { takeRoomLimit } from "@/lib/rooms/limits";
import { e2eLarry } from "@/lib/rooms/e2e-hooks";
import { codeHold, requireCode } from "@/lib/access";
import { RUN_ESTIMATE_USD } from "@/lib/budget";
import { codeBusyResponse, leaseCode } from "@/lib/http";
import { postMessage, refreshGround } from "@/lib/rooms/service";

// Larry can make several Qloo calls per reply.
export const maxDuration = 60;

/**
 * POST /api/rooms/[code]/messages { memberId, token, text, toLarry, location?, persona? }
 *   -> { room, crisis?, personaUpdate? } (personaUpdate: what Larry learned about the asker).
 * When toLarry, the response waits for Larry's reply; other phones see larryBusy meanwhile.
 */
export async function POST(request: Request, ctx: CodeParams) {
  try {
    const code = await codeFrom(request, ctx);
    const body = messageBodySchema.parse(await readJson(request));
    const result = await postMessage(code, body, {
      // Only when Larry (AI) is about to run: it needs an access code, and the run is charged to it.
      // Messages between people, lines while Larry is excused and crisis lines never ask.
      authorize: async () => {
        const access = await requireCode(request);
        if (access instanceof Response) throw new RoomAccessError(access);
        // One of a few runs at once on this code, reserved within its budget. Released with the
        // budget hold (or by its own timeout if the run never got that far).
        const lease = await leaseCode(access.code, RUN_ESTIMATE_USD);
        if (!lease) throw new RoomAccessError(codeBusyResponse());
        return {
          wrap: (hold) => {
            const wrapped = codeHold(access.code, hold);
            return {
              ...wrapped,
              release: () => {
                wrapped.release();
                lease.release();
              },
            };
          },
          charge: lease.charge,
        };
      },
      limit: (kind) => takeRoomLimit(request, kind, code),
      onPicksChanged: () => runAfter(async () => refreshGround(code, await groundFinder(request))),
      runGroupChat: e2eLarry(request),
    });
    return Response.json(result, { headers: NO_STORE });
  } catch (err) {
    return roomErrorResponse(err, request);
  }
}
