import { getSession } from "@/lib/account/session";
import { NO_STORE, groupErrorResponse } from "@/lib/groups/http";
import { profileFor } from "@/lib/people/profile";
import { clientIp, take } from "@/lib/rate-limit";

interface Ctx {
  params: Promise<{ username: string }>;
}

/**
 * GET /api/profile/[username] (bearer optional) -> ProfileData typed for the viewer on the server:
 * stranger (counts only), friend (shares a group; venues and Glory only when both share) or owner.
 * Unknown, deleted and blocked all answer the same 404.
 */
export async function GET(request: Request, ctx: Ctx) {
  try {
    if (!take(`profile:${clientIp(request)}`, { burst: 30, refillPerSec: 1 })) {
      return Response.json({ error: "Lots of taps! Wait a moment, then try again." }, { status: 429, headers: NO_STORE });
    }
    const username = safeDecode((await ctx.params).username);
    if (!/^[A-Za-z0-9]{3,40}$/.test(username)) return Response.json({ error: "We couldn't find that profile." }, { status: 404, headers: NO_STORE });
    const session = await getSession(request).catch(() => null);
    const data = await profileFor(session?.uid ?? null, username);
    if (!data) return Response.json({ error: "We couldn't find that profile." }, { status: 404, headers: NO_STORE });
    return Response.json(data, { headers: NO_STORE });
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
