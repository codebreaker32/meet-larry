import { podiumRerollSchema } from "@/lib/schemas";
import { NO_STORE, groupErrorResponse, readJson, requireSession, takeLimit } from "@/lib/groups/http";
import { readPodium, rerollPodium } from "@/lib/people/podium";
import { clientIp, take } from "@/lib/rate-limit";

interface Ctx {
  params: Promise<{ placeId: string }>;
}

async function placeIdFrom(ctx: Ctx): Promise<string | null> {
  const raw = safeDecode((await ctx.params).placeId);
  // Same rule as the schemas' place id: a Qloo id, at most 64 characters.
  return /^[\w.:-]{1,64}$/.test(raw) ? raw : null;
}

/** GET /api/podium/[placeId]: public, no auth, no "mine". Ranks and per-place aliases only, never visit counts. */
export async function GET(request: Request, ctx: Ctx) {
  if (!take(`podium:${clientIp(request)}`, { burst: 30, refillPerSec: 1 })) {
    return Response.json({ error: "Lots of taps! Wait a moment, then try again." }, { status: 429, headers: NO_STORE });
  }
  const placeId = await placeIdFrom(ctx);
  if (!placeId) return Response.json({ error: "We couldn't find that place." }, { status: 404, headers: NO_STORE });
  try {
    return Response.json(await readPodium(placeId), { headers: { "Cache-Control": "public, max-age=60" } });
  } catch (err) {
    return groupErrorResponse(err);
  }
}

/** POST /api/podium/[placeId] { oldKey, newKey } (18+ account) -> { moved }: a new made-up name. Needs the old SECRET key. */
export async function POST(request: Request, ctx: Ctx) {
  try {
    const s = await requireSession(request);
    takeLimit(s.uid, "manage");
    const placeId = await placeIdFrom(ctx);
    if (!placeId) return Response.json({ error: "We couldn't find that place." }, { status: 404, headers: NO_STORE });
    const { oldKey, newKey } = podiumRerollSchema.parse(await readJson(request));
    const moved = await rerollPodium(placeId, oldKey, newKey);
    return Response.json({ moved }, { status: moved ? 200 : 404, headers: NO_STORE });
  } catch (err) {
    return groupErrorResponse(err);
  }
}

function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return "";
  }
}
