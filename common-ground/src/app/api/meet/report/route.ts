import { meetErrorResponse, NO_STORE, readJson, reportBodySchema, takeMeetLimit } from "@/lib/meet/http";
import { report } from "@/lib/meet/service";

/**
 * POST /api/meet/report { ...same target as /api/meet/block, reason, note? } -> { ok }.
 * Stored for review for 30 days, with the last messages when sent from a chat, and the person is
 * blocked as well. Needs no access code.
 */
export async function POST(request: Request) {
  try {
    takeMeetLimit(request, "safety");
    const { reason, note, ...target } = reportBodySchema.parse(await readJson(request));
    return Response.json(await report(target, reason, note), { headers: NO_STORE });
  } catch (err) {
    return meetErrorResponse(err);
  }
}
