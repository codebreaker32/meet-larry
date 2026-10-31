import { connection, type NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/http";
import { searchEntities } from "@/lib/qloo";
import { rateLimit } from "@/lib/rate-limit";
import { type Domain, DOMAIN_KEYS } from "@/lib/types";

const querySchema = z.object({
  q: z.string().trim().min(1).max(80),
  domain: z.enum(DOMAIN_KEYS as [Domain, ...Domain[]]).optional(),
});

export async function GET(request: NextRequest) {
  // Always per request (rate limit by IP, live Qloo search); never prerendered at build.
  await connection();
  try {
    const limited = rateLimit(request, "qloo");
    if (limited) return limited;
    const params = request.nextUrl.searchParams;
    const parsed = querySchema.safeParse({
      q: params.get("q") ?? "",
      domain: params.get("domain") ?? undefined,
    });
    if (!parsed.success) return Response.json({ error: "Type a name to search." }, { status: 400 });
    const { q, domain } = parsed.data;
    return Response.json({ results: await searchEntities(q, domain, 8) });
  } catch (err) {
    return errorResponse(err);
  }
}
