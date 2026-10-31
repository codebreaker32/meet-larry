import { handleArrive } from "@/lib/checkin-verify";

/**
 * POST /api/checkins/arrive (ArriveRequest) -> ArriveResponse, or { error, reason } when the visit
 * can't start ("too-far", "closed", "fuzzy", "already-today", "no-place"). The fix is checked against
 * the Qloo place (and Amazon's cross-checked pin) and thrown away. Nothing in the body is logged.
 */
export async function POST(request: Request) {
  return handleArrive(request);
}
