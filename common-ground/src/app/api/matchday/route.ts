import { connection, type NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/http";
import { getMatchDay, matchDayFallback } from "@/lib/matchday";
import { rateLimit } from "@/lib/rate-limit";
import type { MatchDay } from "@/lib/types/signals-ui";

// GET /api/matchday?entities=<qloo ids>&team=<name> -> { matchDays, fallback? }
// Only hand-verified, sourced fixtures inside the window (src/lib/matchday.ts). With none, an empty
// list and Larry's honest line: no fixture = no date, never an invented game.

const querySchema = z.object({
  entities: z
    .string()
    .max(400)
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(z.string().regex(/^[\w-]{1,64}$/)).min(1).max(10)),
  team: z.string().trim().max(80).optional(),
});

export async function GET(request: NextRequest) {
  await connection();
  try {
    const limited = rateLimit(request, "qloo");
    if (limited) return limited;
    const params = request.nextUrl.searchParams;
    const parsed = querySchema.safeParse({ entities: params.get("entities") ?? "", team: params.get("team") || undefined });
    if (!parsed.success) return Response.json({ error: "Pick a team first." }, { status: 400 });
    const matchDays: MatchDay[] = getMatchDay(parsed.data.entities);
    return Response.json(
      { matchDays, ...(matchDays.length ? {} : { fallback: matchDayFallback(parsed.data.team) }) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
