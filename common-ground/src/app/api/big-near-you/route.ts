import { connection, type NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { AGE_BUCKETS, type AgeBucket } from "@/lib/types/signals";
import { bigNearYou } from "./big";

// GET /api/big-near-you?lat=&lon=&age= -> { items: TasteItem[] } (movies only). The point is the
// device's stored coarse location (about 1 km); the server rounds it further to a city cell.
const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  age: z.enum(AGE_BUCKETS as unknown as [AgeBucket, ...AgeBucket[]]).optional(),
});

export async function GET(request: NextRequest) {
  await connection();
  try {
    const limited = rateLimit(request, "qloo");
    if (limited) return limited;
    const p = request.nextUrl.searchParams;
    const parsed = querySchema.safeParse({ lat: p.get("lat") ?? undefined, lon: p.get("lon") ?? undefined, age: p.get("age") ?? undefined });
    if (!parsed.success) return Response.json({ items: [] }, { status: 400 });
    const { lat, lon, age } = parsed.data;
    const items = await bigNearYou(lat, lon, age);
    return Response.json({ items }, { headers: { "Cache-Control": "private, max-age=3600" } });
  } catch (err) {
    return errorResponse(err);
  }
}
