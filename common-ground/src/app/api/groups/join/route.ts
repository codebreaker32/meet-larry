import { NO_STORE, groupErrorResponse, joinSchema, openAfter, readJson, requireSession, takeLimit } from "@/lib/groups/http";
import { joinGroup, previewJoin } from "@/lib/groups/service";

// Larry can make Qloo calls and one curation call for the opening, after the response.
export const maxDuration = 60;

/**
 * POST /api/groups/join (18+ account)
 *   { action: "preview", token }            -> { names, openSeats, size }  (who is in it, before joining)
 *   { action: "join", token, profile, signals? } -> { group }
 * Scanning the QR and tapping Join is the consent. When the group fills, Larry opens it.
 */
export async function POST(request: Request) {
  try {
    const s = await requireSession(request);
    takeLimit(s.uid, "join");
    const body = joinSchema.parse(await readJson(request));
    if (body.action === "preview") return Response.json(await previewJoin(s.uid, body.token), { headers: NO_STORE });
    const { group, formed } = await joinGroup(s.uid, { token: body.token, profile: body.profile, ...(body.signals ? { signals: body.signals } : {}) });
    if (formed) openAfter(request, group.id);
    return Response.json({ group }, { headers: NO_STORE });
  } catch (err) {
    return groupErrorResponse(err);
  }
}
