import { playback, playbackSchema } from "@/lib/checkin-verify";
import { optionalLease, readJsonBody } from "@/lib/http";

/** One short Larry line is reserved against the access code. */
const PLAYBACK_RESERVE_USD = 0.02;

/**
 * POST /api/checkins/playback -> { line, plain, source }. Larry's line after a counted visit,
 * written from the real place and stage with the Guess vs Reality rules as constraints. Without a
 * usable access code, over the limit, or when the model fails, a fixed line that follows the same
 * rules answers instead. Nothing is stored.
 */
export async function POST(request: Request) {
  const parsed = playbackSchema.safeParse(await readJsonBody(request, 2_000).catch(() => null));
  if (!parsed.success) return Response.json({ error: "Hmm, that didn't go through. Try again in a moment?" }, { status: 400 });
  const lease = await optionalLease(request, PLAYBACK_RESERVE_USD, { limit: "curate" }).catch(() => null);
  try {
    return Response.json(await playback(parsed.data, lease ? { charge: lease.charge } : undefined), { headers: { "Cache-Control": "no-store" } });
  } finally {
    lease?.release();
  }
}
