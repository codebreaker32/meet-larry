import { getSession } from "@/lib/account/session";
import { handleLeave, verifyVisitToken } from "@/lib/checkin-verify";
import { addPodiumVisit } from "@/lib/people/podium";

/**
 * POST /api/checkins/leave (LeaveRequest) -> LeaveResponse. Verifies the visit (20+ minutes, both
 * fixes at the place, no ride past, one per place per day) and adds an account's Glory. The fix and
 * the podium key are never logged or stored.
 *
 * Podium hook (2B, D12): after a VERIFIED leave, one visit goes on the place's podium under
 * sha256(podiumKey), only for an 18+ account with "Show me on place leaderboards" on. No uid is
 * written next to it, and a failure here never changes the answer.
 */
export async function POST(request: Request) {
  const copy = request.clone();
  const res = await handleLeave(request);
  if (res.status !== 200) return res;
  try {
    const out = (await res.clone().json()) as { verified?: boolean };
    if (out.verified) {
      const body = (await copy.json().catch(() => null)) as { visitToken?: unknown; podiumKey?: unknown } | null;
      const visit = typeof body?.visitToken === "string" ? verifyVisitToken(body.visitToken) : null;
      const key = typeof body?.podiumKey === "string" ? body.podiumKey : undefined;
      if (visit && key) await addPodiumVisit(await getSession(copy).catch(() => null), visit.placeId, key);
    }
  } catch {
    // The visit already counted; the podium simply misses this one.
  }
  return res;
}
