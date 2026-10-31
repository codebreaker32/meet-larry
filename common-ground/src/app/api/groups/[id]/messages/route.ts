import { e2eLarry } from "@/lib/rooms/e2e-hooks";
import {
  type IdParams,
  NO_STORE,
  authorizeFor,
  groundFinderFor,
  groupErrorResponse,
  groupIdFrom,
  messageSchema,
  readJson,
  requireSession,
  runAfter,
  takeLimit,
} from "@/lib/groups/http";
import { postMessage, pruneOld } from "@/lib/groups/service";

// Larry can make several Qloo calls per reply.
export const maxDuration = 60;

/**
 * POST /api/groups/[id]/messages { text, location?, persona?, signals? } (member)
 *   -> { group, messages, crisis?, personaUpdate? }.
 * Larry answers only a line that starts with @Larry or a /command; the answer is in this response.
 * Larry runs are charged to the asker's account (Larry time).
 */
export async function POST(request: Request, ctx: IdParams) {
  try {
    const s = await requireSession(request);
    const id = await groupIdFrom(ctx);
    const body = messageSchema.parse(await readJson(request));
    const ground = await groundFinderFor(request).catch(() => undefined);
    const result = await postMessage(
      s.uid,
      id,
      body,
      {
        limit: (kind) => takeLimit(s.uid, kind, id),
        authorize: authorizeFor(request),
        ...(ground?.fake ? { find: ground.find, fixedOpener: true } : {}),
        ...(e2eLarry(request) ? { runGroupChat: e2eLarry(request) } : {}),
      },
    );
    if (Math.random() < 0.05) runAfter(() => pruneOld(id));
    return Response.json(result, { headers: NO_STORE });
  } catch (err) {
    return groupErrorResponse(err);
  }
}
